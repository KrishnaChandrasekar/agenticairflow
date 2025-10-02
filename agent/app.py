
from __future__ import annotations
import json
import os
import shlex
import shutil
import subprocess
import threading
import time
from typing import Optional

import psutil
import requests
from flask import Flask, jsonify, request, send_file

# =========================
# Reconciliation Logic
# =========================
def _reconcile_and_report():
    """
    On agent startup, scan all job directories, check status, and report to router.
    """
    try:
        jobs = []
        if not os.path.isdir(AGENT_HOME):
            return
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
            if pid and _alive(pid):
                status = "RUNNING"
            elif os.path.exists(rcp):
                try:
                    rc = int(open(rcp).read().strip())
                except Exception:
                    rc = 1
                status = "SUCCEEDED" if rc == 0 else "FAILED"
            jobs.append({"job_id": job_id, "status": status, "pid": pid, "rc": rc})

        # Report to router
        if jobs:
            url = f"{ROUTER_URL.rstrip('/')}/agents/reconcile"
            headers = {"X-Agent-Token": AGENT_TOKEN, "Content-Type": "application/json"}
            payload = {"agent_id": AGENT_ID, "jobs": jobs}
            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=10)
                print(f"[agent] Reconciliation report sent: {resp.status_code}", flush=True)
            except Exception as e:
                print(f"[agent] Reconciliation report failed: {e}", flush=True)
    except Exception as e:
        print(f"[agent] Reconciliation logic error: {e}", flush=True)

# =========================
# Configuration (env vars)
# =========================
AGENT_HOME = os.environ.get("AGENT_HOME", "/app/agent_jobs")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "agent-secret")
AGENT_AUTO_REGISTER = os.environ.get("AGENT_AUTO_REGISTER","false").lower() in ("1","true","yes")
HEARTBEAT_SECONDS = int(os.environ.get("AGENT_HEARTBEAT_SECONDS","10"))

# Auto-register settings
ROUTER_URL = os.environ.get("ROUTER_URL", "http://router:8000").rstrip("/")
AGENT_ID = os.environ.get("AGENT_ID", "vm1")
SELF_URL = os.environ.get("SELF_URL", "http://agent_vm1:8001")
try:
    AGENT_LABELS = json.loads(os.environ.get("AGENT_LABELS", '{"os":"linux","zone":"dev"}'))
except Exception:
    AGENT_LABELS = {"os": "linux", "zone": "dev"}

# Use bash if available, otherwise sh
SHELL = "/bin/bash" if shutil.which("bash") else "/bin/sh"

# Ensure workspace exists
os.makedirs(AGENT_HOME, exist_ok=True)

app = Flask(__name__)


# =========================
# Helpers
# =========================
def _alive(pid: int) -> bool:
    try:
        p = psutil.Process(pid)
        try:
            if getattr(psutil, "STATUS_ZOMBIE", None) and p.status() == psutil.STATUS_ZOMBIE:
                return False
        except Exception:
            pass
        return p.is_running()
    except Exception:
        return False


def _ensure_home(job_id: str) -> str:
    p = os.path.join(AGENT_HOME, job_id)
    os.makedirs(p, exist_ok=True)
    return p


import time as _time
def _writeln(path: str, text: str, retries: int = 3):
    for attempt in range(retries):
        try:
            with open(path, "a", encoding="utf-8", errors="ignore") as f:
                f.write(text)
                f.flush()
            break
        except Exception as e:
            if attempt < retries - 1:
                _time.sleep(0.05)
            else:
                print(f"[agent] log write failed: {e}", flush=True)


def _write_text(path: str, text: str):
    with open(path, "w", encoding="utf-8", errors="ignore") as f:
        f.write(text)


def _auto_register_forever():
    """
    Keep the agent registered (idempotent).
    - First attempt immediately on startup.
    - Retry every 60s on success, 10s on failure.
    """
    body = {
        "agent_id": AGENT_ID,
        "url": SELF_URL,        # must be reachable from Router (service DNS inside compose)
        "labels": AGENT_LABELS,
    }
    headers = {"X-Agent-Token": AGENT_TOKEN, "Content-Type": "application/json"}

    def once() -> bool:
        try:
            r = requests.post(f"{ROUTER_URL}/agents/register", json=body, headers=headers, timeout=5)
            # Treat 200 as success; other codes will be retried
            app.logger.info("agent register -> %s %s", r.status_code, (r.text[:200] if r.text else ""))
            return r.status_code == 200
        except Exception as e:
            app.logger.warning("agent register failed: %s", e)
            return False

    # initial attempt
    ok = once()
    delay = 60 if ok else 10

    while True:
        time.sleep(delay)
        ok = once()
        delay = 60 if ok else 10


# =========================
# HTTP Endpoints
# =========================

def _send_hello():
    try:
        requests.post(f"{ROUTER_URL.rstrip('/')}/agents/hello",
                      json={"agent_id": AGENT_ID, "url": SELF_URL, "labels": (json.loads(AGENT_LABELS) if AGENT_LABELS else {})},
                      timeout=10)
    except Exception as e:
        print("hello failed:", e, flush=True)

def _heartbeat_loop():
    while True:
        try:
            requests.post(f"{ROUTER_URL.rstrip('/')}/agents/heartbeat", json={"agent_id": AGENT_ID, "url": SELF_URL}, timeout=10)
        except Exception as e:
            print("heartbeat failed:", e, flush=True)
        time.sleep(HEARTBEAT_SECONDS)

def _auto_register_once():
    try:
        r = requests.post(f"{ROUTER_URL.rstrip('/')}/agents/register",
                          headers={"X-Agent-Token": AGENT_TOKEN},
                          json={"agent_id": AGENT_ID, "url": SELF_URL, "labels": (json.loads(AGENT_LABELS) if AGENT_LABELS else {})},
                          timeout=10)
        print("auto-register:", r.status_code, r.text[:120], flush=True)
    except Exception as e:
        print("auto-register failed:", e, flush=True)


# on startup
_send_hello()
_reconcile_and_report()
if AGENT_AUTO_REGISTER:
    _auto_register_once()
import threading as _t
_t.Thread(target=_heartbeat_loop, daemon=True).start()

@app.get("/health")
def health():
    return jsonify({"ok": True, "shell": SHELL, "home": AGENT_HOME})


@app.post("/run")
def run():
    # Auth
    if request.headers.get("X-Agent-Token") != AGENT_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(force=True) or {}
    job_id: Optional[str] = data.get("job_id")
    payload = data.get("payload") or {}
    if not job_id:
        return jsonify({"error": "job_id required"}), 400

    # Extract job spec
    cmd: str = payload.get("command") or ""
    run_as: Optional[str] = payload.get("run_as")
    cwd: str = payload.get("cwd") or "/"
    extra_env: dict = payload.get("env") or {}
    timeout_seconds: Optional[int] = payload.get("timeout_seconds")

    # Paths
    home = _ensure_home(job_id)
    logp = os.path.join(home, "run.log")
    pidp = os.path.join(home, "pid")
    rcp = os.path.join(home, "rc")

    # Banner
    _writeln(logp, f"[agent] shell={SHELL}\n")
    _writeln(logp, f"[agent] job_id={job_id}\n")
    _writeln(logp, f"[agent] cwd={cwd}\n")
    _writeln(logp, f"[agent] command={cmd}\n")
    _writeln(logp, f"[agent] env={json.dumps(extra_env)}\n")
    _writeln(logp, f"[agent] status=PENDING\n")

    # Validate cwd
    if not os.path.isdir(cwd):
        _writeln(logp, f"[agent] ERROR: cwd not found: {cwd}\n")
        _write_text(rcp, "255\n")
        return jsonify({"ok": False, "log_path": logp}), 200

    # Validate sudo if run_as requested
    if run_as and not shutil.which("sudo"):
        _writeln(logp, "[agent] ERROR: sudo not available for run_as\n")
        _write_text(rcp, "255\n")
        return jsonify({"ok": False, "log_path": logp}), 200

    # Build environment for the child process
    env = {**os.environ, **{k: str(v) for k, v in extra_env.items()}}



    # Build robust, POSIX-compliant detachment command (Go agent style)
    safe_cmd = cmd.replace("'", "'\\''")
    core = f"( cd {shlex.quote(home)} || exit 255; sh -c '{safe_cmd}'; echo $? > {shlex.quote(rcp)} )"
    launch = f"setsid nohup sh -c \"{core}\" >> {shlex.quote(logp)} 2>&1 & echo $! > {shlex.quote(pidp)}"
    if run_as:
        launch = f"sudo -u {shlex.quote(run_as)} {launch}"

    _writeln(logp, f"[agent] launch={launch}\n")

    # Spawn
    try:
        subprocess.Popen(["sh", "-c", launch], env=env)
    except Exception as e:
        _writeln(logp, f"[agent] spawn exception: {e}\n")
        _writeln(logp, f"[agent] status=FAILED\n")
        _write_text(rcp, "255\n")
        return jsonify({"ok": False, "log_path": logp}), 200

    # Optional watchdog to kill after timeout_seconds
    if timeout_seconds:
        watchdog = (
            f"""( sleep {int(timeout_seconds)}; """
            f"""if [ -f {shlex.quote(pidp)} ] && kill -0 $(cat {shlex.quote(pidp)}) 2>/dev/null; """
            f"""then kill -TERM $(cat {shlex.quote(pidp)}); fi ) >/dev/null 2>&1 &"""
        )
        try:
            subprocess.Popen([SHELL, "-lc", watchdog], env=env)
        except Exception as e:
            _writeln(logp, f"[agent] watchdog spawn exception: {e}\n")

    return jsonify({"ok": True, "log_path": logp}), 200


@app.get("/status/<job_id>")
def status(job_id: str):
    if request.headers.get("X-Agent-Token") != AGENT_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    home = os.path.join(AGENT_HOME, job_id)
    pidp = os.path.join(home, "pid")
    rcp = os.path.join(home, "rc")
    logp = os.path.join(home, "run.log")

    pid: Optional[int] = None
    if os.path.exists(pidp):
        try:
            pid = int(open(pidp, "r", encoding="utf-8", errors="ignore").read().strip())
        except Exception:
            pid = None

    statusp = os.path.join(home, "status.txt")
    def _last_status():
        try:
            with open(statusp, "r", encoding="utf-8", errors="ignore") as f:
                return f.read().strip()
        except Exception:
            return None

    def _write_status(val):
        with open(statusp, "w", encoding="utf-8", errors="ignore") as f:
            f.write(val)

    if os.path.exists(rcp):
        try:
            rc = int(open(rcp, "r", encoding="utf-8", errors="ignore").read().strip())
        except Exception:
            rc = 1
        status_val = "SUCCEEDED" if rc == 0 else "FAILED"
        if _last_status() != status_val:
            _writeln(logp, f"[agent] status={status_val}\n")
            _write_status(status_val)
        return jsonify({"status": status_val, "job_id": job_id, "log_path": logp, "rc": rc})

    # If no rc yet, only then check pid/alive
    if pid and _alive(pid):
        if _last_status() != "RUNNING":
            _writeln(logp, f"[agent] status=RUNNING\n")
            _write_status("RUNNING")
        return jsonify({"status": "RUNNING", "job_id": job_id, "log_path": logp, "rc": None})


        try:
            rc = int(open(rcp, "r", encoding="utf-8", errors="ignore").read().strip())
        except Exception:
            rc = 1
        return jsonify(
            {
                "status": "SUCCEEDED" if rc == 0 else "FAILED",
                "job_id": job_id,
                "log_path": logp,
                "rc": rc,
            }
        )

    # Neither pid nor rc present → consider it a failed spawn and surface that
    return jsonify(
        {"status": "FAILED", "job_id": job_id, "log_path": logp, "rc": 255, "error": "no pid/rc"}
    )


@app.get("/logs/<job_id>")
def logs(job_id: str):
    if request.headers.get("X-Agent-Token") != AGENT_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    logp = os.path.join(AGENT_HOME, job_id, "run.log")
    if not os.path.exists(logp):
        return jsonify({"error": "no log"}), 404
    return send_file(logp, mimetype="text/plain")


# =========================
# Startup: auto-register
# =========================
def _start_autoreg():
    t = threading.Thread(target=_auto_register_forever, name="auto-register", daemon=True)
    t.start()


_start_autoreg()

# =========================
# Main
# =========================
if __name__ == "__main__":
    # Bind to 0.0.0.0:8001 (match SELF_URL port and your compose exposure)
    app.run(host="0.0.0.0", port=8001)
