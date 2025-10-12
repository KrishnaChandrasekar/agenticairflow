"""
Task callbacks for notifying Router of status changes
"""
import logging
from typing import Optional, Dict, Any
from airflow.utils.context import Context
from airflow.exceptions import AirflowException

from agentic_ssh.status_update_hook import AgenticRouterStatusHook


logger = logging.getLogger(__name__)


def notify_router_on_failure(context: Context) -> None:
    """
    Callback function to notify Router when a task fails
    
    Usage:
        Add to task definition:
        task = AgenticRunOperator(
            task_id='my_task',
            on_failure_callback=notify_router_on_failure,
            ...
        )
    """
    _notify_router_status_change(context, 'FAILED')


def notify_router_on_success(context: Context) -> None:
    """
    Callback function to notify Router when a task succeeds
    
    Usage:
        Add to task definition:
        task = AgenticRunOperator(
            task_id='my_task', 
            on_success_callback=notify_router_on_success,
            ...
        )
    """
    _notify_router_status_change(context, 'SUCCEEDED')


def notify_router_on_retry(context: Context) -> None:
    """
    Callback function to notify Router when a task retries
    
    Usage:
        Add to task definition:
        task = AgenticRunOperator(
            task_id='my_task',
            on_retry_callback=notify_router_on_retry, 
            ...
        )
    """
    _notify_router_status_change(context, 'FAILED', reason='Task retry triggered')


def _notify_router_status_change(
    context: Context, 
    status: str, 
    reason: Optional[str] = None
) -> None:
    """
    Internal helper to notify Router of status changes
    
    Args:
        context: Airflow task context
        status: New status (FAILED, SUCCEEDED, CANCELLED)
        reason: Optional reason for status change
    """
    try:
        # Extract task information from context
        task_instance = context.get('task_instance')
        dag_run = context.get('dag_run')
        
        if not task_instance or not dag_run:
            logger.warning("Missing task_instance or dag_run in context")
            return
        
        current_state = task_instance.current_state()
        logger.info(f"Processing Router notification: {status} for {task_instance.dag_id}.{task_instance.task_id}")
        
        if current_state not in ['FAILED', 'DEFERRED', 'SUCCESS', 'UP_FOR_RETRY']:
            logger.warning(f"Unexpected Airflow task state: {current_state}")
            
        dag_id = task_instance.dag_id
        task_id = task_instance.task_id
        run_id = dag_run.run_id
        
        # Get job_id from XCom for this specific task
        job_id = None
        try:
            from airflow.models.xcom import XCom
            from airflow.utils.db import provide_session
            
            @provide_session
            def get_job_id_from_xcom(session=None):
                xcom_entry = session.query(XCom).filter(
                    XCom.dag_id == dag_id,
                    XCom.task_id == task_id,
                    XCom.run_id == run_id,
                    XCom.key == 'agentic_job_id'
                ).first()
                
                if xcom_entry:
                    return xcom_entry.value
                else:
                    logger.warning(f"No job_id found in XCom for {dag_id}.{task_id}")
                    return None
            
            job_id = get_job_id_from_xcom()
                    
        except Exception as e:
            logger.error(f"Error retrieving job_id from XCom for {dag_id}.{task_id}: {e}")
        
        # Get connection ID from task if available
        conn_id = 'agentic_run_default'
        if hasattr(task_instance.task, 'conn_id'):
            conn_id = task_instance.task.conn_id
        
        # Setup hook and notify Router
        hook = AgenticRouterStatusHook(conn_id=conn_id)
        
        # Build reason if not provided
        if not reason:
            if status == 'FAILED':
                # Try to get exception info
                exception = context.get('exception')
                if exception:
                    reason = f"Task failed: {str(exception)[:200]}"
                else:
                    reason = "Task failed in Airflow"
            elif status == 'SUCCEEDED':
                reason = "Task completed successfully in Airflow"
        
        response = hook.notify_status_change(
            dag_id=dag_id,
            task_id=task_id, 
            run_id=run_id,
            status=status,
            job_id=job_id,
            reason=reason
        )
        
        logger.info(
            f"Successfully notified Router about {dag_id}.{task_id} "
            f"status change to {status}: {response}"
        )
        
        # Store notification details in XCom for audit
        task_instance.xcom_push(
            key='router_status_notification',
            value={
                'timestamp': context.get('ts', ''),
                'status': status,
                'reason': reason,
                'response': response
            }
        )
        
    except Exception as e:
        # Log error but don't fail the task
        logger.error(f"Failed to notify Router of status change: {e}")
        
        # Optionally store error in XCom
        try:
            task_instance.xcom_push(
                key='router_notification_error',
                value={
                    'timestamp': context.get('ts', ''),
                    'error': str(e),
                    'attempted_status': status
                }
            )
        except Exception:
            pass  # Ignore XCom errors


def notify_router_on_execute_complete_failure(context: Context) -> None:
    """
    Special callback for deferred tasks that fail during execute_complete
    """
    _notify_router_status_change(context, 'FAILED', reason='Deferred task marked as failed')


class AgenticCallbackMixin:
    """
    Mixin class to add Router status notification callbacks to operators
    
    Usage:
        class MyAgenticOperator(AgenticCallbackMixin, BaseOperator):
            def __init__(self, enable_router_callbacks=True, **kwargs):
                super().__init__(**kwargs)
                if enable_router_callbacks:
                    self.setup_router_callbacks()
    """
    
    def setup_router_callbacks(self, 
                              on_failure: bool = True,
                              on_success: bool = False, 
                              on_retry: bool = True):
        """
        Setup Router notification callbacks on this operator
        
        Args:
            on_failure: Enable failure notifications
            on_success: Enable success notifications  
            on_retry: Enable retry notifications
        """
        if on_failure:
            if hasattr(self, 'on_failure_callback') and self.on_failure_callback:
                # Chain with existing callback
                original_callback = self.on_failure_callback
                def chained_failure_callback(context):
                    notify_router_on_failure(context)
                    original_callback(context)
                self.on_failure_callback = chained_failure_callback
            else:
                self.on_failure_callback = notify_router_on_failure
                
        if on_success:
            if hasattr(self, 'on_success_callback') and self.on_success_callback:
                # Chain with existing callback
                original_callback = self.on_success_callback
                def chained_success_callback(context):
                    notify_router_on_success(context)
                    original_callback(context)
                self.on_success_callback = chained_success_callback
            else:
                self.on_success_callback = notify_router_on_success
                
        if on_retry:
            if hasattr(self, 'on_retry_callback') and self.on_retry_callback:
                # Chain with existing callback
                original_callback = self.on_retry_callback
                def chained_retry_callback(context):
                    notify_router_on_retry(context)
                    original_callback(context)
                self.on_retry_callback = chained_retry_callback
            else:
                self.on_retry_callback = notify_router_on_retry