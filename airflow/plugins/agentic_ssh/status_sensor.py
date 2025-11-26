"""
Sensor to detect task state changes and notify Router
"""
import json
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from airflow import DAG
from airflow.models import TaskInstance, DagRun
from airflow.sensors.base import BaseSensorOperator
from airflow.utils.context import Context
from airflow.utils.state import State
from airflow.exceptions import AirflowSkipException

from agentic_ssh.status_update_hook import AgenticRouterStatusHook


class TaskStatusSensor(BaseSensorOperator):
    """
    Sensor that monitors task instances and notifies Router of status changes
    """
    
    template_fields = ('target_dag_id', 'target_task_id')
    
    def __init__(
        self,
        target_dag_id: str,
        target_task_id: str,
        conn_id: str = "agentic_run_default", 
        monitored_states: list = None,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.target_dag_id = target_dag_id
        self.target_task_id = target_task_id
        self.conn_id = conn_id
        self.monitored_states = monitored_states or [State.FAILED, State.SUCCESS, State.UP_FOR_RETRY]
        self.hook = AgenticRouterStatusHook(conn_id=conn_id)
        
    def poke(self, context: Context) -> bool:
        """Check if target task has changed to a monitored state"""
        
        # Get current dag run
        dag_run = context.get('dag_run')
        if not dag_run:
            self.log.warning("No DAG run found in context")
            return False
            
        run_id = dag_run.run_id
        
        # Find the task instance we're monitoring
        task_instance = context['task_instance'].get_task_instance(
            dag_id=self.target_dag_id,
            task_id=self.target_task_id, 
            run_id=run_id
        )
        
        if not task_instance:
            self.log.info(f"Task {self.target_dag_id}.{self.target_task_id} not found for run {run_id}")
            return False
            
        current_state = task_instance.current_state()
        
        # Check if task is in a monitored state  
        # Note: AgenticRunOperator tasks go QUEUED → DEFERRED → FAILED/SUCCESS, never RUNNING
        if current_state in self.monitored_states:
            self.log.info(
                f"Detected status change: {self.target_dag_id}.{self.target_task_id} "
                f"is now {current_state} for run {run_id} (Router job should be terminated)"
            )
            
            # Map Airflow states to Router states
            # Note: AgenticRunOperator tasks are DEFERRED, not RUNNING in Airflow
            status_map = {
                State.FAILED: "FAILED",
                State.SUCCESS: "SUCCEEDED", 
                State.UP_FOR_RETRY: "FAILED",  # Treat retries as failures
                State.UPSTREAM_FAILED: "FAILED",
                State.SKIPPED: "CANCELLED"
            }
            
            router_status = status_map.get(current_state, "FAILED")
            
            # Get reason if available
            reason = None
            if hasattr(task_instance, 'log') and task_instance.log:
                try:
                    # Try to extract failure reason from logs
                    if current_state == State.FAILED:
                        reason = f"Airflow task failed: {current_state}"
                except Exception:
                    pass
            
            # Try to get job_id from task instance XCom if available
            job_id = None
            try:
                job_id = task_instance.xcom_pull(key='agentic_job_id')
                self.log.info(f"Found job_id {job_id} in XCom")
            except Exception as e:
                self.log.info(f"No job_id found in XCom: {e}")
            
            # Notify Router
            try:
                response = self.hook.notify_status_change(
                    dag_id=self.target_dag_id,
                    task_id=self.target_task_id,
                    run_id=run_id,
                    status=router_status,
                    job_id=job_id,
                    reason=reason
                )
                
                self.log.info(f"Successfully notified Router: {response}")
                
                # Store notification in XCom for audit
                context['task_instance'].xcom_push(
                    key='router_notification',
                    value={
                        'timestamp': datetime.utcnow().isoformat(),
                        'status': router_status,
                        'response': response
                    }
                )
                
                return True
                
            except Exception as e:
                self.log.error(f"Failed to notify Router: {e}")
                # Don't fail the sensor, just log the error
                return False
                
        else:
            self.log.debug(
                f"Task {self.target_dag_id}.{self.target_task_id} "
                f"is in state {current_state}, not monitoring"
            )
            return False


def create_status_monitor_dag(
    monitored_dag_id: str,
    monitored_task_id: str,
    dag_id: str = None,
    schedule_interval: str = '@once',
    conn_id: str = 'agentic_run_default'
) -> DAG:
    """
    Factory function to create a status monitoring DAG
    
    Args:
        monitored_dag_id: DAG ID to monitor
        monitored_task_id: Task ID to monitor  
        dag_id: Optional custom DAG ID for monitor
        schedule_interval: How often to check
        conn_id: Connection ID for Router API
    
    Returns:
        DAG instance for monitoring task status
    """
    if not dag_id:
        dag_id = f"{monitored_dag_id}_{monitored_task_id}_status_monitor"
    
    default_args = {
        'owner': 'agentic_system',
        'depends_on_past': False,
        'start_date': datetime(2024, 1, 1),
        'email_on_failure': False,
        'email_on_retry': False,
        'retries': 1,
        'retry_delay': timedelta(minutes=5)
    }
    
    dag = DAG(
        dag_id,
        default_args=default_args,
        description=f'Monitor status changes for {monitored_dag_id}.{monitored_task_id}',
        schedule_interval=schedule_interval,
        catchup=False,
        tags=['agentic', 'monitoring', 'status']
    )
    
    monitor_task = TaskStatusSensor(
        task_id='monitor_task_status',
        target_dag_id=monitored_dag_id,
        target_task_id=monitored_task_id,
        conn_id=conn_id,
        timeout=300,  # 5 minutes timeout
        poke_interval=30,  # Check every 30 seconds
        dag=dag
    )
    
    return dag