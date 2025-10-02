
from datetime import datetime
from airflow import DAG
from agentic_ssh.AgenticSSH_operators import AgenticRunOperator

with DAG(
    dag_id="agentic_mvp_demo",
    start_date=datetime(2025, 9, 1),
    schedule=None,
    catchup=False,
    tags=["agentic-demo"],
):
    vm1_ok = AgenticRunOperator(
        task_id="vm1_ok",
        agent_id="vm1",
        command="echo 'vm1 starting'; for i in 1 2 3 4 5; do echo tick:$i; sleep 2; done; echo 'vm1 done'",
        cwd="/",
    )
    go_vm1_ok = AgenticRunOperator(
        task_id="go_vm1_ok",
        agent_id="go_vm1",
        command="echo 'go_vm1 starting'; for i in 1 2 3 4 5; do echo tick:$i; sleep 10; done; echo 'go_vm1 done'",
        cwd="/",
    )
    vm4_ok = AgenticRunOperator(
        task_id="vm4_ok",
        agent_id="vm4",
        command="echo 'this should run at the end'",
        cwd="/",
    )
    [vm1_ok, go_vm1_ok] >> vm4_ok
