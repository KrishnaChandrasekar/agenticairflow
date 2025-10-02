# Agent Job Reconciliation Logic
# This script is intended to be integrated into agent/app.py startup.
# It scans all job directories, checks for running/completed jobs, and prints their status.

import os
import psutil

AGENT_HOME = os.environ.get("AGENT_HOME", "/app/agent_jobs")

def alive(pid):
    try:
        p = psutil.Process(pid)
        return p.is_running()
    except Exception:
        return False

def reconcile_jobs():
    jobs = []
    if not os.path.isdir(AGENT_HOME):
        return jobs
    for job_id in os.listdir(AGENT_HOME):
        home = os.path.join(AGENT_HOME, job_id)
        pidp = os.path.join(home, "pid")
        rcp = os.path.join(home, "rc")
        status = "UNKNOWN"
        pid = None
        rc = None
        if os.path.exists(pidp):
            try:
                pid = int(open(pidp).read().strip())
            except Exception:
                pid = None
        if pid and alive(pid):
            status = "RUNNING"
        elif os.path.exists(rcp):
            try:
                rc = int(open(rcp).read().strip())
            except Exception:
                rc = 1
            status = "SUCCEEDED" if rc == 0 else "FAILED"
        jobs.append({"job_id": job_id, "status": status, "pid": pid, "rc": rc})
    return jobs

if __name__ == "__main__":
    for job in reconcile_jobs():
        print(job)
