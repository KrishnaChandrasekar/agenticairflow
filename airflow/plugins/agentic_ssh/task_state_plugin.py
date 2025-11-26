"""
Airflow Plugin to monitor AgenticRunOperator task state changes
and ensure Router is always notified, even for manual failures.
"""
import logging
from typing import Any, Optional

from airflow import __version__ as airflow_version
from airflow.models import TaskInstance 
from airflow.plugins_manager import AirflowPlugin
from airflow.utils.state import TaskInstanceState

logger = logging.getLogger(__name__)


class AgenticTaskStateListener:
    """
    Listener for AgenticRunOperator task state changes
    
    This ensures Router gets notified even when normal callbacks fail,
    such as manual task failures in the Airflow UI.
    """
    
    @staticmethod
    def on_task_instance_state_change(previous_state: str, current_state: str, task_instance: TaskInstance) -> None:
        """
        Called when a task instance changes state
        
        Args:
            previous_state: Previous state of the task
            current_state: New state of the task  
            task_instance: The task instance that changed state
        """
        try:
            # Only monitor AgenticRunOperator tasks
            if (hasattr(task_instance, 'task') and 
                hasattr(task_instance.task, '__class__') and
                task_instance.task.__class__.__name__ == 'AgenticRunOperator'):
                
                logger.info(f"[AGENTIC LISTENER] Task {task_instance.dag_id}.{task_instance.task_id} "
                           f"changed from {previous_state} to {current_state}")
                
                # Check for manual failure scenarios
                if (previous_state in ['DEFERRED', 'RUNNING'] and 
                    current_state == TaskInstanceState.FAILED):
                    
                    logger.info(f"[AGENTIC LISTENER] Detected manual failure: {task_instance.dag_id}.{task_instance.task_id}")
                    
                    # Check if we already notified Router (to avoid duplicates)
                    try:
                        already_notified = task_instance.xcom_pull(key='manual_failure_notified')
                        if already_notified:
                            logger.info("[AGENTIC LISTENER] Router already notified, skipping")
                            return
                    except Exception:
                        pass  # XCom might not exist yet
                    
                    # Notify Router of the failure
                    AgenticTaskStateListener._notify_router_failure(task_instance)
                    
        except Exception as e:
            logger.error(f"[AGENTIC LISTENER] Error handling state change: {e}")
    
    @staticmethod
    def _notify_router_failure(task_instance: TaskInstance) -> None:
        """Notify Router that a task failed"""
        try:
            from agentic_ssh.status_callbacks import _notify_router_status_change
            
            # Create minimal context
            context = {
                'task_instance': task_instance,
                'dag_run': task_instance.dag_run,
                'ts': task_instance.end_date.isoformat() if task_instance.end_date else None
            }
            
            # Notify Router
            _notify_router_status_change(
                context, 
                'FAILED', 
                'Task manually failed (detected by state listener)'
            )
            
            # Mark as notified to prevent duplicates
            task_instance.xcom_push(key='listener_failure_notified', value=True)
            
            logger.info(f"[AGENTIC LISTENER] Successfully notified Router of failure for "
                       f"{task_instance.dag_id}.{task_instance.task_id}")
                       
        except Exception as e:
            logger.error(f"[AGENTIC LISTENER] Failed to notify Router: {e}")


# Hook into Airflow's task instance state change system
# Note: This depends on Airflow version and available hooks
try:
    # Try to register with Airflow's lifecycle hooks if available
    from airflow.listeners import hookimpl
    
    @hookimpl
    def on_task_instance_running(previous_state, task_instance, session):
        """Called when task instance starts running"""
        AgenticTaskStateListener.on_task_instance_state_change(
            previous_state, TaskInstanceState.RUNNING, task_instance
        )
    
    @hookimpl  
    def on_task_instance_success(previous_state, task_instance, session):
        """Called when task instance succeeds"""
        AgenticTaskStateListener.on_task_instance_state_change(
            previous_state, TaskInstanceState.SUCCESS, task_instance
        )
        
    @hookimpl
    def on_task_instance_failed(previous_state, task_instance, session):
        """Called when task instance fails"""
        AgenticTaskStateListener.on_task_instance_state_change(
            previous_state, TaskInstanceState.FAILED, task_instance
        )
        
    logger.info("[AGENTIC PLUGIN] Registered task state listeners")
    
except ImportError:
    # Airflow version doesn't support listeners
    logger.warning("[AGENTIC PLUGIN] Task state listeners not supported in this Airflow version")


class AgenticTaskMonitorPlugin(AirflowPlugin):
    """
    Airflow plugin for monitoring AgenticRunOperator task state changes
    """
    name = "agentic_task_monitor"
    
    # Register listeners if supported
    listeners = []
    try:
        from airflow.listeners import hookimpl
        # In newer Airflow versions, listeners are registered differently
        logger.info("[AGENTIC PLUGIN] Plugin registered successfully")
    except ImportError:
        logger.info("[AGENTIC PLUGIN] Running in compatibility mode")