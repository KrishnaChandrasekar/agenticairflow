
# Agentic Airflow Ecosystem: System Architecture & Quickstart

![System Architecture](architecture.jpg)

This MVP brings up **Airflow 2.10.5** (CeleryExecutor), the **Agent Router**, and one or more **Agent VMs** on a single Docker network. The Airflow plugin and demo DAG are pre-mounted for rapid experimentation.


## 1. Quickstart

```bash
cd agentic-mvp
docker compose up --build -d
# Wait ~30s for airflow-init to create the admin user
```


## 2. Health Checks

```bash
curl http://localhost:8000/            # Router root -> 200
curl http://localhost:8000/health      # Router health -> {"ok": true}
curl http://localhost:8001/health      # Agent info
```


## 3. Airflow UI & Demo DAG

- Open [http://localhost:8080](http://localhost:8080)
- Login: `admin` / `admin`
- DAG: `agentic_mvp_demo` (unpause, then trigger)


The connection `agentic_ssh_default` is preconfigured via env:

```
AIRFLOW_CONN_AGENTIC_SSH_DEFAULT='http://:router-secret@router:8000'
```
The plugin uses this to submit jobs to the Router and poll status.


**Note:** The Airflow operator previously named `AgenticSSHOperator` is now called `AgenticRunOperator`. It does not use SSH, but instead runs commands or scripts on the targeted OS via the Agentic Router and Agents. Update your DAGs and plugins to use `AgenticRunOperator` for all job execution tasks.

**Ecosystem Note:** This system supports both Python-based agents and Go-based agents. You can run agents implemented in either language, and they will interoperate seamlessly within the same Agentic Router and Airflow environment.


## 4. What You'll See

- Task `run_on_vm1` runs on the Agent with hostname `vm1.local`, **detached**.
- On the Agent container: job dirs at `/app/agent_jobs/<job_id>/run.log`, `pid`, `rc`.
- Logs available via Router `/logs/<job_id>` with `Authorization: Bearer router-secret`.


## 5. Troubleshooting

- If Airflow containers fail to install packages, ensure `_PIP_ADDITIONAL_REQUIREMENTS="requests aiohttp"` is present in compose.
- If the DAG stays queued: check `router` and `agent_vm1` logs; ensure Agent publishes `host=vm1.local` and the DAG route labels include that.
- Tokens: Router expects `Authorization: Bearer router-secret`; Agent expects `X-Agent-Token: agent-secret`.


## 6. Customization

- Add a second Agent: duplicate the `agent_vm1` block in `docker-compose.yml` with `hostname: vm2.local`, change ports to avoid conflicts, and run a second task with `route_labels={"host":"vm2.local"}`.
- Change Airflow credentials: edit the `airflow-init` command in the compose file.
