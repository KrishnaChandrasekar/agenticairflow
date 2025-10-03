from airflow.plugins_manager import AirflowPlugin
from agentic_ssh.AgenticSSH_operators import AgenticRunOperator
from agentic_ssh.AgenticSSH_triggers import AgenticSSHRouterStatusTrigger

class AgenticSSHPlugin(AirflowPlugin):
    name = "agentic_ssh"
    operators = [AgenticRunOperator]
    triggers = [AgenticSSHRouterStatusTrigger]
