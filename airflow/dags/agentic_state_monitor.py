"""
Task state change detector for handling manual Airflow task state changes
This handles cases where tasks are manually marked as failed while in deferred state
"""
import logging
from airflow.models import TaskInstance
from airflow.models.serialized_dag import SerializedDagModel
from airflow.utils.state import State
from airflow.utils.db import provide_session
from airflow.hooks.base import BaseHook
from agentic_ssh.status_update_hook import AgenticRouterStatusHook

logger = logging.getLogger(__name__)


class AgenticTaskStateMonitor:
    """Monitor for detecting manual task state changes and notifying Router"""
    
    def __init__(self, conn_id: str = "agentic_run_default"):
        self.conn_id = conn_id
        self.hook = AgenticRouterStatusHook(conn_id)
    
    @provide_session
    def check_for_manual_failures(self, session=None):
        """
        Check for tasks that were manually marked as failed from DEFERRED state
        This catches manual failures of deferred AgenticRunOperator tasks
        """
        try:
            # Query for recently failed tasks that might be AgenticRunOperator tasks
            # Focus on tasks that likely went DEFERRED → FAILED (manual failure scenario)
            # AgenticRunOperator tasks never show RUNNING in Airflow, only DEFERRED
            failed_tasks = session.query(TaskInstance).filter(
                TaskInstance.state == State.FAILED,
                TaskInstance.end_date.isnot(None)
            ).limit(100).all()
            
            logger.info(f"[STATE MONITOR] Checking {len(failed_tasks)} failed tasks for potential DEFERRED→FAILED transitions")
            
            for task_instance in failed_tasks:
                # Check if this task has Agentic job metadata in XCom
                job_id = task_instance.xcom_pull(key='agentic_job_id')
                if job_id:
                    # Check if we've already notified Router for this task instance
                    notification_key = f'router_manual_failure_{task_instance.run_id}'
                    already_notified = task_instance.xcom_pull(key=notification_key)
                    
                    if not already_notified:
                        logger.info(f"Detected manual failure for {task_instance.dag_id}.{task_instance.task_id} - notifying Router")
                        
                        # Notify Router
                        try:
                            response = self.hook.notify_status_change(
                                dag_id=task_instance.dag_id,
                                task_id=task_instance.task_id,
                                run_id=task_instance.run_id,
                                status='FAILED',
                                job_id=job_id,
                                reason='Manual task failure detected by state monitor'
                            )
                            
                            # Mark as notified to avoid duplicate notifications
                            task_instance.xcom_push(
                                key=notification_key,
                                value={
                                    'timestamp': task_instance.end_date.isoformat() if task_instance.end_date else None,
                                    'response': response,
                                    'detected_by': 'state_monitor'
                                }
                            )
                            
                            logger.info(f"Successfully notified Router for manual failure: {response}")
                            
                        except Exception as e:
                            logger.error(f"Failed to notify Router for manual failure: {e}")
                            
        except Exception as e:
            logger.error(f"Error in check_for_manual_failures: {e}")


def create_state_monitor_dag():
    """
    Create a DAG that periodically checks for manual task state changes
    This is a backup mechanism for catching manual failures of deferred tasks
    """
    from datetime import datetime, timedelta
    from airflow import DAG
    from airflow.operators.python import PythonOperator
    
    def monitor_task_states():
        monitor = AgenticTaskStateMonitor()
        monitor.check_for_manual_failures()
    
    default_args = {
        'owner': 'agentic_system',
        'depends_on_past': False,
        'start_date': datetime(2024, 1, 1),
        'email_on_failure': False,
        'email_on_retry': False,
        'retries': 1,
        'retry_delay': timedelta(minutes=1)
    }
    
    dag = DAG(
        'agentic_state_monitor',
        default_args=default_args,
        description='Monitor manual task state changes for Router notification',
        schedule_interval=timedelta(minutes=2),  # Check every 2 minutes
        catchup=False,
        tags=['agentic', 'monitoring', 'internal']
    )
    
    monitor_task = PythonOperator(
        task_id='check_manual_failures',
        python_callable=monitor_task_states,
        dag=dag
    )
    
    return dag


# Auto-create the monitoring DAG (optional backup mechanism)
agentic_state_monitor_dag = create_state_monitor_dag()