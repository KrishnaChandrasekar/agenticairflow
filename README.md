# Agentic MVP (All-in-One): Airflow 2.10.5 + Router + Agent

This package brings up **Airflow 2.10.5** (CeleryExecutor), the **Agentic Router**, and a single **Agent VM** on one docker network. The Airflow plugin and demo DAG are pre-mounted.

## 1) Start everything
```bash
cd agentic-mvp
docker compose up --build -d
# wait ~30s for airflow-init to create the admin user
```

## 2) Health checks
```bash
curl http://localhost:8000/            # Router root -> 200
curl http://localhost:8000/health      # Router health -> {"ok": true}
curl http://localhost:8001/health      # Agent info
```

## 3) Airflow UI
- Open http://localhost:8080
- Login: admin / admin
- DAG: `agentic_mvp_demo` (unpause, then trigger)

The **connection** `agentic_ssh_default` is preconfigured via env:
```
AIRFLOW_CONN_AGENTIC_SSH_DEFAULT='http://:router-secret@router:8000'
```
The plugin will use that to submit to Router and poll status.

## 4) What you'll see
- Task `run_on_vm1` runs on the Agent with hostname `vm1.local`, **detached**.
- On the Agent container: job dirs at `/app/agent_jobs/<job_id>/run.log pid rc`.
- Logs available via Router `/logs/<job_id>` with `Authorization: Bearer router-secret`.

## 5) Troubleshooting
- If Airflow containers fail to install packages, ensure `_PIP_ADDITIONAL_REQUIREMENTS="requests aiohttp"` is present in compose.
- If the DAG stays queued: check `router` and `agent_vm1` logs; ensure Agent publishes `host=vm1.local` and the DAG route labels include that.
- Tokens: Router expects `Authorization: Bearer router-secret`; Agent expects `X-Agent-Token: agent-secret`.

## 6) Customize
- Add a second Agent: duplicate `agent_vm1` block with `hostname: vm2.local`, change ports to avoid conflicts, and run a second task with `route_labels={"host":"vm2.local"}`.
- Change Airflow creds: edit the `airflow-init` command.
