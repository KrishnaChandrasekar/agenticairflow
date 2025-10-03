import requests
from typing import Dict, Optional
from airflow.models import BaseOperator
from airflow.utils.context import Context
from airflow.triggers.base import TriggerEvent
from airflow.exceptions import AirflowException
from airflow.hooks.base import BaseHook
from agentic_ssh.AgenticSSH_triggers import AgenticSSHRouterStatusTrigger

CONN_ID_DEFAULT = "agentic_ssh_default"

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
        self.timeout_seconds = timeout_seconds
        self.priority = priority
        self.conn_id = conn_id
        self.poll_seconds = poll_seconds
        self.job_id: Optional[str] = None

    def execute(self, context: Context):
        router_url, token, default_labels = _read_conn(self.conn_id)
        labels = {**default_labels, **self.route_labels}
        payload = {
            "job": {
                "command": self.command if isinstance(self.command, str) else " ".join(self.command),
                "run_as": self.run_as,
                "cwd": self.cwd,
                "env": self.env,
                "timeout_seconds": self.timeout_seconds,
                "detached": True,
                "dag_id": context["dag"].dag_id,
                "task_id": context["task"].task_id,
            },
            "route": ({"agent_id": self.agent_id} if self.agent_id else {"labels": labels}),
            "priority": self.priority,
        }

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
