from airflow.plugins_manager import AirflowPlugin
from agentic_ssh.AgenticSSH_operators import AgenticSSHOperator
from agentic_ssh.AgenticSSH_triggers import AgenticSSHRouterStatusTrigger

class AgenticSSHPlugin(AirflowPlugin):
    name = "agentic_ssh"
    operators = [AgenticSSHOperator]
    triggers = [AgenticSSHRouterStatusTrigger]
