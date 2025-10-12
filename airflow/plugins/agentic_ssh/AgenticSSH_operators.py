import requests
from typing import Dict, Optional
from airflow.models import BaseOperator
from airflow.utils.context import Context
from airflow.triggers.base import TriggerEvent
from airflow.exceptions import AirflowException
from airflow.hooks.base import BaseHook
from agentic_ssh.AgenticSSH_triggers import AgenticSSHRouterStatusTrigger

CONN_ID_DEFAULT = "agentic_run_default"

def _conn_url_from_host(c) -> Optional[str]:
    scheme = (c.conn_type or "http").lower()
    host = c.host or ""
    port = f":{c.port}" if c.port else ""
    base = f"{scheme}://{host}{port}"
    if c.extra_dejson.get("base_path"):
        base = f"{base.rstrip('/')}/{c.extra_dejson['base_path'].lstrip('/')}"
    return base

def _read_conn(conn_id: str):
    conn = BaseHook.get_connection(conn_id)
    base_url = _conn_url_from_host(conn)
    token = conn.password or conn.extra_dejson.get("token") or ""
    default_labels = conn.extra_dejson.get("labels") or {}
    if not base_url:
        raise AirflowException(f"{conn_id}: missing base_url/host")
    return base_url, token, default_labels


class AgenticRunOperator(BaseOperator):
    template_fields = ("command", "cwd", "run_as", "agent_id", "route_labels")

    def __init__(
        self,
        *,
        command,
        agent_id: Optional[str] = None,
        route_labels: Optional[Dict] = None,
        run_as: Optional[str] = None,
        cwd: Optional[str] = None,
        env: Optional[Dict] = None,
        priority: int = 5,
        timeout_seconds: int = 3600,
        conn_id: str = CONN_ID_DEFAULT,
        poll_seconds: int = 5,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.command = command
        self.agent_id = agent_id
        self.route_labels = route_labels or {}
        self.run_as = run_as
        self.cwd = cwd
        self.env = env or {}
        # Interpret 0, None, or unset as 'no timeout'
        if timeout_seconds is None or timeout_seconds == 0:
            self.timeout_seconds = None
        else:
            self.timeout_seconds = timeout_seconds
        self.priority = priority
        self.conn_id = conn_id
        self.poll_seconds = poll_seconds
        self.job_id: Optional[str] = None
        
        # Always setup Router status callbacks for Airflow-Router integration
        self._setup_router_callbacks()

    def _setup_router_callbacks(self):
        """Setup Router notification callbacks on this operator"""
        try:
            from agentic_ssh.status_callbacks import notify_router_on_failure, notify_router_on_retry
            
            # Setup failure callback with enhanced logging
            def enhanced_failure_callback(context):
                self.log.info(f"[AGENTIC CALLBACK] Failure callback triggered for {self.task_id}")
                notify_router_on_failure(context)
            
            # Setup retry callback with enhanced logging  
            def enhanced_retry_callback(context):
                self.log.info(f"[AGENTIC CALLBACK] Retry callback triggered for {self.task_id}")
                notify_router_on_retry(context)
            
            # Setup failure callback
            if hasattr(self, 'on_failure_callback') and self.on_failure_callback:
                # Chain with existing callback
                original_callback = self.on_failure_callback
                def chained_failure_callback(context):
                    enhanced_failure_callback(context)
                    original_callback(context)
                self.on_failure_callback = chained_failure_callback
            else:
                self.on_failure_callback = enhanced_failure_callback
                
            # Setup retry callback
            if hasattr(self, 'on_retry_callback') and self.on_retry_callback:
                # Chain with existing callback
                original_callback = self.on_retry_callback
                def chained_retry_callback(context):
                    enhanced_retry_callback(context)
                    original_callback(context)
                self.on_retry_callback = chained_retry_callback
            else:
                self.on_retry_callback = enhanced_retry_callback
                
            self.log.info(f"[AGENTIC] Router callbacks setup completed for {self.task_id}")
                
        except ImportError as e:
            print(f"[AgenticRunOperator] Warning: Could not setup Router callbacks: {e}")

    def execute(self, context: Context):
        router_url, token, default_labels = _read_conn(self.conn_id)
        labels = {**default_labels, **self.route_labels}
        job_payload = {
            "command": self.command if isinstance(self.command, str) else " ".join(self.command),
            "run_as": self.run_as,
            "cwd": self.cwd,
            "env": self.env,
            "detached": True,
            "dag_id": context["dag"].dag_id,
            "task_id": context["task"].task_id,
            "run_id": context["run_id"],
        }
        # Only include timeout_seconds if set and not None
        if self.timeout_seconds is not None:
            job_payload["timeout_seconds"] = self.timeout_seconds
        payload = {
            "job": job_payload,
            "route": ({"agent_id": self.agent_id} if self.agent_id else {"labels": labels}),
            "priority": self.priority,
        }
        # Print and log the payload for debugging
        import pprint
        pprint.pprint(payload)
        self.log.info("Payload sent to Router: %s", payload)

        r = requests.post(
            f"{router_url.rstrip('/')}/submit",
            json=payload,
            headers={"Authorization": f"Bearer {token}"} if token else {},
            timeout=30,
        )
        if r.status_code != 200:
            raise AirflowException(f"Router submit failed: HTTP {r.status_code} {r.text[:400]}")
        data = r.json()
        self.job_id = data["job_id"]
        
        # Store job_id in XCom for status callbacks
        context["task_instance"].xcom_push(key="agentic_job_id", value=self.job_id)
        self.log.info(f"Submitted job {self.job_id} to Router, stored in XCom")

        # Defer until terminal state
        return self.defer(
            trigger=AgenticSSHRouterStatusTrigger(
                router_url=router_url,
                token=token,
                job_id=self.job_id,
                poll_seconds=self.poll_seconds,
            ),
            method_name="execute_complete",
        )

    def execute_complete(self, context: Context, event: dict):
        st = event.get("status")
        rc = event.get("return_code")
        
        # Log the trigger event for debugging
        self.log.info(f"[AGENTIC] execute_complete: trigger_event={event}")
        
        # Check if this is a manual failure scenario (Router callbacks always enabled)
        task_instance = context.get('task_instance')
        if task_instance:
            current_state = task_instance.current_state()
            self.log.info(f"[AGENTIC] execute_complete: router_job_status={st}, airflow_task_state={current_state}")
            
            # Enhanced manual failure detection
            # Case 1: Task is already FAILED when execute_complete is called
            if current_state and str(current_state).upper() == 'FAILED':
                self.log.info("[AGENTIC] Task manually failed while deferred - ensuring Router notification")
                try:
                    from agentic_ssh.status_callbacks import _notify_router_status_change
                    _notify_router_status_change(context, 'FAILED', 'DEFERRED task manually marked as FAILED in execute_complete')
                    # Also try to store notification flag
                    task_instance.xcom_push(key='manual_failure_notified', value=True)
                except Exception as e:
                    self.log.warning(f"[AGENTIC] Router notification failed: {e}")
                # Continue with normal failure handling
                
            # Case 2: Trigger event indicates failure but Router job was still running
            elif st in ["FAILED", "CANCELLED", "TIMEOUT"]:
                self.log.info(f"[AGENTIC] Trigger reports job failure: {st}")
                try:
                    from agentic_ssh.status_callbacks import _notify_router_status_change
                    _notify_router_status_change(context, 'FAILED', f'Job failed on agent: {st}')
                except Exception as e:
                    self.log.warning(f"[AGENTIC] Router notification failed: {e}")
                    
            # Case 3: Check for race conditions - if we have job_id but trigger says success,
            # verify with Router if job is actually complete
            elif st == "SUCCEEDED" and self.job_id:
                try:
                    router_url, token, _ = _read_conn(self.conn_id)
                    job_status_response = requests.get(
                        f"{router_url.rstrip('/')}/job/{self.job_id}/status",
                        headers={"Authorization": f"Bearer {token}"} if token else {},
                        timeout=10,
                    )
                    if job_status_response.status_code == 200:
                        router_status = job_status_response.json().get('status')
                        if router_status and router_status != 'SUCCEEDED':
                            self.log.warning(f"[AGENTIC] Status mismatch: trigger says SUCCESS but Router says {router_status}")
                except Exception as e:
                    self.log.debug(f"[AGENTIC] Could not verify job status with Router: {e}")
        
        # Enhanced failure detection for edge cases
        if event.get("error") or (st and st != "SUCCEEDED"):
            # This is a failure case - ensure Router is notified
            self.log.info(f"[AGENTIC] Job failed with status {st}, ensuring Router notification")
            try:
                from agentic_ssh.status_callbacks import _notify_router_status_change
                error_msg = event.get("error", f"Job failed with status: {st}")
                _notify_router_status_change(context, 'FAILED', error_msg)
            except Exception as e:
                self.log.warning(f"[AGENTIC] Router notification failed: {e}")
        
        if st == "SUCCEEDED" and (rc in (0, "0", None)):
            return
        # Try to pull logs for context (best-effort)
        try:
            router_url, token, _ = _read_conn(self.conn_id)
            if self.job_id:
                lr = requests.get(
                    f"{router_url.rstrip('/')}/logs/{self.job_id}",
                    headers={"Authorization": f"Bearer {token}"} if token else {},
                    timeout=30,
                )
                if lr.status_code == 200:
                    self.log.info("---- Remote agent log start ----\n%s\n---- Remote agent log end ----", lr.text)
        except Exception:
            pass
        raise AirflowException(f"Agent job failed: {event}")
