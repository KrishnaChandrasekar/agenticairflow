import os, shlex, subprocess, time, psutil

AGENT_HOME = os.environ.get("AGENT_HOME", "/app/agent_jobs")

def ensure_home(job_id):
    path = os.path.join(AGENT_HOME, job_id)
    os.makedirs(path, exist_ok=True)
    return path

def pid_running(pid: int) -> bool:
    try:
        p = psutil.Process(pid)
        return p.is_running()
    except Exception:
        return False

def start_detached(job_id, command, run_as=None, cwd=None, env=None, timeout_seconds=None):
    home = ensure_home(job_id)
    log = os.path.join(home, "run.log")
    pidp = os.path.join(home, "pid")
    rcp  = os.path.join(home, "rc")

    cmd = command if isinstance(command, str) else " ".join(command)
    if run_as:
        cmd = f"sudo -n -u {shlex.quote(run_as)} bash -lc {shlex.quote(cmd)}"

    wrapped = f"bash -lc 'setsid nohup bash -lc {shlex.quote(cmd)} >> {shlex.quote(log)} 2>&1; echo $? > {shlex.quote(rcp)}'"
    full = f"bash -lc 'setsid nohup {wrapped} >> {shlex.quote(log)} 2>&1 & echo $! > {shlex.quote(pidp)}'"

    subprocess.Popen(full, shell=True, cwd=cwd, env={**os.environ, **(env or {})})

    if timeout_seconds:
        watchdog = f"(sleep {int(timeout_seconds)}; if kill -0 $(cat {pidp}) 2>/dev/null; then kill -TERM $(cat {pidp}); fi) >/dev/null 2>&1 &"
        subprocess.Popen(["bash","-lc", watchdog], cwd=cwd)

    for _ in range(50):
        if os.path.exists(pidp):
            break
        time.sleep(0.1)

    return {"log_path": log, "pid_path": pidp, "rc_path": rcp}

def check_status(job_id):
    home = os.path.join(AGENT_HOME, job_id)
    pidp = os.path.join(home, "pid")
    rcp  = os.path.join(home, "rc")
    log  = os.path.join(home, "run.log")

    pid = None
    if os.path.exists(pidp):
        try: pid = int(open(pidp).read().strip())
        except Exception: pid = None

    if pid and pid_running(pid):
        return {"status":"RUNNING", "log_path":log}

    if os.path.exists(rcp):
        try: rc = int(open(rcp).read().strip())
        except Exception: rc = 1
        return {"status": "SUCCEEDED" if rc==0 else "FAILED", "rc": rc, "log_path": log}

    return {"status":"RUNNING", "log_path":log}
