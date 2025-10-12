"""
Example DAG demonstrating Airflow-Router status synchronization

This DAG shows how AgenticRunOperator tasks automatically notify the Router 
when they fail, allowing the Router to stop corresponding jobs on agents and 
update status. Router callbacks are ALWAYS ENABLED for all AgenticRunOperator tasks.

Tasks are routed to different agents:
- vm1, vm2, vm3, vm4: Python agents (have /stop endpoint)
- go_vm1: Go agent (no /stop endpoint, graceful degradation)
"""
from datetime import datetime, timedelta
from airflow import DAG
from agentic_ssh.AgenticSSH_operators import AgenticRunOperator

# DAG configuration
default_args = {
    'owner': 'agentic_system',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5)
}

dag = DAG(
    'agentic_status_sync_demo',
    default_args=default_args,
    description='Demo of Airflow-Router status synchronization',
    schedule_interval=timedelta(hours=1),
    catchup=False,
    tags=['agentic', 'demo', 'status-sync']
)

# Task that will likely succeed
successful_task = AgenticRunOperator(
    task_id='successful_command',
    command='echo "This task will succeed" && sleep 10',
    agent_id='vm1',  # Route to Python agent vm1
    timeout_seconds=30,
    # Router callbacks are enabled by default
    dag=dag
)

# Task that will fail
failing_task = AgenticRunOperator(
    task_id='failing_command', 
    command='echo "This task will fail" && sleep 5 && exit 1',
    agent_id='vm2',  # Route to Python agent vm2
    timeout_seconds=30,
    # Router callbacks enabled - will notify Router on failure
    dag=dag
)

# Task with custom agent routing
agent_specific_task = AgenticRunOperator(
    task_id='agent_specific_command',
    command='echo "Running on specific agent" && sleep 15',
    agent_id='vm3',  # Route to Python agent vm3
    timeout_seconds=45,
    dag=dag
)

# Task with Go agent routing that might fail
go_agent_task = AgenticRunOperator(
    task_id='go_agent_command',
    command='echo "Running on Go agent" && sleep 10',
    agent_id='go_vm1',  # Route to Go agent (note: no /stop endpoint)
    timeout_seconds=60,
    dag=dag
)

# Task with chained custom callback (for testing)
custom_callback_task = AgenticRunOperator(
    task_id='custom_callback_command',
    command='echo "Router callbacks always enabled" && sleep 5',
    agent_id='vm4',  # Route to Python agent vm4
    timeout_seconds=30,
    dag=dag
)

# Set up task dependencies
successful_task >> failing_task >> agent_specific_task
successful_task >> go_agent_task >> custom_callback_task