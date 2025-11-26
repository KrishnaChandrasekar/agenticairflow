"""
Manual Failure Monitor for AgenticRunOperator tasks

This module provides monitoring for tasks that are manually marked as FAILED
in the Airflow UI while in DEFERRED state. It ensures Router gets notified
even when normal callbacks don't fire.
"""
import logging
import time
from typing import Dict, Set, Optional
from datetime import datetime, timedelta
from threading import Thread, Event

from airflow.models import TaskInstance, DagRun
from airflow.utils.db import provide_session
from airflow.utils.state import TaskInstanceState
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

logger = logging.getLogger(__name__)


class ManualFailureMonitor:
    """
    Monitor for AgenticRunOperator tasks that are manually failed
    
    This monitors the Airflow database for AgenticRunOperator tasks that
    transition from DEFERRED to FAILED state, indicating manual failure.
    When detected, it triggers Router notification.
    """
    
    def __init__(self, check_interval: int = 5):
        self.check_interval = check_interval
        self.running = False
        self.stop_event = Event()
        self.monitor_thread: Optional[Thread] = None
        self.known_tasks: Dict[str, str] = {}  # task_key -> last_known_state
        
    def start(self):
        """Start the monitoring thread"""
        if self.running:
            return
            
        self.running = True
        self.stop_event.clear()
        self.monitor_thread = Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("Manual failure monitor started")
        
    def stop(self):
        """Stop the monitoring thread"""
        if not self.running:
            return
            
        self.running = False
        self.stop_event.set()
        if self.monitor_thread:
            self.monitor_thread.join(timeout=10)
        logger.info("Manual failure monitor stopped")
        
    def _monitor_loop(self):
        """Main monitoring loop"""
        while self.running and not self.stop_event.wait(self.check_interval):
            try:
                self._check_for_manual_failures()
            except Exception as e:
                logger.error(f"Error in manual failure monitor: {e}")
                
    @provide_session
    def _check_for_manual_failures(self, session: Session = None):
        """Check for AgenticRunOperator tasks that were manually failed"""
        try:
            # Look for AgenticRunOperator tasks that are currently FAILED
            # and were recently DEFERRED (indicating manual failure)
            from airflow.utils.timezone import utcnow
            cutoff_time = utcnow() - timedelta(hours=1)  # Check last hour
            
            failed_tasks = session.query(TaskInstance).filter(
                and_(
                    TaskInstance.operator == 'AgenticRunOperator',
                    TaskInstance.state == TaskInstanceState.FAILED,
                    TaskInstance.end_date >= cutoff_time
                )
            ).all()
            
            for task in failed_tasks:
                # Extract the task details while we have the session
                task_key = f"{task.dag_id}.{task.task_id}.{task.run_id}"
                task_details = {
                    'dag_id': task.dag_id,
                    'task_id': task.task_id,
                    'run_id': task.run_id,
                    'state': task.state,
                    'end_date': task.end_date
                }
                
                # Check if this is a new failure we haven't processed
                if task_key not in self.known_tasks or self.known_tasks[task_key] != 'FAILED':
                    # This is a newly failed task - check if it was deferred before
                    if self._was_recently_deferred(task, session):
                        logger.info(f"Detected manual failure of deferred task: {task_key}")
                        # Pass task details instead of the task instance
                        self._handle_manual_failure(task_details)
                    
                    self.known_tasks[task_key] = 'FAILED'
                    
        except Exception as e:
            logger.error(f"Error checking for manual failures: {e}")
            
    def _was_recently_deferred(self, task_instance: TaskInstance, session: Session) -> bool:
        """Check if task was recently in DEFERRED state"""
        try:
            # Check if there's XCom data for this task (indicates it was deferred)
            from airflow.models.xcom import XCom
            
            xcom_count = session.query(XCom).filter(
                XCom.dag_id == task_instance.dag_id,
                XCom.task_id == task_instance.task_id,
                XCom.run_id == task_instance.run_id,
                XCom.key == 'agentic_job_id'
            ).count()
            
            return xcom_count > 0
        except Exception as e:
            logger.debug(f"Error checking if task was deferred: {e}")
            return False
            
    @provide_session
    def _handle_manual_failure(self, task_details: dict, session: Session = None):
        """Handle a manually failed task by notifying Router"""
        try:
            # Import here to avoid circular imports
            from agentic_ssh.status_callbacks import _notify_router_status_change
            from airflow.utils.context import Context
            
            # Get a fresh task instance from the session
            fresh_ti = session.query(TaskInstance).filter(
                TaskInstance.dag_id == task_details['dag_id'],
                TaskInstance.task_id == task_details['task_id'],
                TaskInstance.run_id == task_details['run_id']
            ).first()
            
            if not fresh_ti:
                logger.error(f"Could not find task instance {task_details['dag_id']}.{task_details['task_id']}")
                return
            
            # Log the task instance details for debugging
            logger.info(f"Processing manual failure for task: {fresh_ti.dag_id}.{fresh_ti.task_id}")
            logger.debug(f"Task instance state: {fresh_ti.state}, run_id: {fresh_ti.run_id}")
            
            # Verify XCom data exists for this specific task instance
            try:
                from airflow.models.xcom import XCom
                
                job_id_xcom = session.query(XCom).filter(
                    XCom.dag_id == fresh_ti.dag_id,
                    XCom.task_id == fresh_ti.task_id,
                    XCom.run_id == fresh_ti.run_id,
                    XCom.key == 'agentic_job_id'
                ).first()
                
                job_id_check = job_id_xcom.value if job_id_xcom else None
                logger.info(f"Verified job_id {job_id_check} for task {fresh_ti.dag_id}.{fresh_ti.task_id}")
                    
            except Exception as e:
                logger.warning(f"Could not verify job_id for {fresh_ti.dag_id}.{fresh_ti.task_id}: {e}")
            
            # Create a minimal context for the callback
            context = {
                'task_instance': fresh_ti,
                'dag_run': fresh_ti.dag_run,
                'ts': fresh_ti.end_date.isoformat() if fresh_ti.end_date else None
            }
            
            # Notify Router of the failure
            _notify_router_status_change(
                context, 
                'FAILED', 
                'Task manually marked as FAILED (detected by monitor)'
            )
            
            logger.info(f"Successfully notified Router of manual failure for {fresh_ti.dag_id}.{fresh_ti.task_id}")
            
        except Exception as e:
            logger.error(f"Failed to handle manual failure for {task_details['dag_id']}.{task_details['task_id']}: {e}")


# Global monitor instance
_monitor_instance: Optional[ManualFailureMonitor] = None


def start_manual_failure_monitor():
    """Start the global manual failure monitor"""
    global _monitor_instance
    if _monitor_instance is None:
        _monitor_instance = ManualFailureMonitor()
    _monitor_instance.start()


def stop_manual_failure_monitor():
    """Stop the global manual failure monitor"""
    global _monitor_instance
    if _monitor_instance:
        _monitor_instance.stop()


# Auto-start the monitor when module is imported
# This ensures it runs in the Airflow scheduler process
try:
    # Only start in scheduler/worker processes, not in webserver
    import os
    if os.environ.get('AIRFLOW_WORKER_TYPE') != 'webserver':
        start_manual_failure_monitor()
        logger.info("Manual failure monitor auto-started")
except Exception as e:
    logger.warning(f"Could not auto-start manual failure monitor: {e}")