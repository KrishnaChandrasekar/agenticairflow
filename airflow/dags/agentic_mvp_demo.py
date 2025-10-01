
from datetime import datetime
from airflow import DAG
from agentic_ssh.AgenticSSH_operators import AgenticSSHOperator

with DAG(
    dag_id="agentic_mvp_demo",
    start_date=datetime(2025, 9, 1),
    schedule=None,
    catchup=False,
    tags=["agentic-demo"],
):
    vm1_ok = AgenticSSHOperator(
        task_id="vm1_ok",
        agent_id="vm1",
        command="echo 'vm1 starting'; for i in 1 2 3 4 5; do echo tick:$i; sleep 2; done; echo 'vm1 done'",
        cwd="/",
    )
    vm2_ok = AgenticSSHOperator(
        task_id="vm2_ok",
        agent_id="vm2",
        command="echo 'vm2 starting'; for i in 1 2 3 4 5; do echo tick:$i; sleep 10; done; echo 'vm2 done'",
        cwd="/",
    )
    vm4_fail = AgenticSSHOperator(
        task_id="vm4_unregistered_should_fail",
        agent_id="vm4",
        command="echo 'this should not run'",
        cwd="/",
    )
    [vm1_ok, vm2_ok] >> vm4_fail
