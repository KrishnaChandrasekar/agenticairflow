
from __future__ import annotations
from datetime import datetime
import json
import os
import shlex
import shutil
import subprocess
import threading
import time
from typing import Optional

# Certificate generation utilities and secure registration setup
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    print("[agent] Warning: cryptography library not available, secure registration disabled", flush=True)

import psutil
import requests
from flask import Flask, jsonify, request, send_file

# =========================
# Reconciliation Logic
# =========================
def _reconcile_and_report():
    """
    On agent startup, scan all job directories, check status, and report to router.
    Also cleanup any orphaned jobs that are stuck in RUNNING state.
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
            
            # Check if job already completed
            if os.path.exists(rcp):
                try:
                    rc = int(open(rcp).read().strip())
                except Exception:
                    rc = 1
                status = "SUCCEEDED" if rc == 0 else "FAILED"
            # Check if job is actually running (with enhanced validation)
            elif pid and _alive(pid, job_id):
                status = "RUNNING"
            # Job has PID but process is not the original one or doesn't exist
            elif pid:
                # This is an orphaned job - cleanup and mark as FAILED
                _cleanup_orphaned_job(job_id, "Container restart detected - original process no longer exists")
                status = "FAILED"
                rc = 130  # Set rc to indicate terminated by signal
            # No PID file exists - job never started properly
            else:
                _cleanup_orphaned_job(job_id, "No PID file found - job never started properly")
                status = "FAILED"
                rc = 255  # Set rc to indicate startup failure
                
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
HEARTBEAT_SECONDS = int(os.environ.get("AGENT_HEARTBEAT_SECONDS","10"))

# Registration settings

ROUTER_URL = os.environ.get("ROUTER_URL", "http://router:8000").rstrip("/")
AGENT_ID = os.environ.get("AGENT_ID", "vm1")
SELF_URL = os.environ.get("SELF_URL", "http://agent_vm1:8001")
try:
    AGENT_LABELS = json.loads(os.environ.get("AGENT_LABELS", '{"os":"linux","zone":"dev"}'))
except Exception:
    AGENT_LABELS = {"os": "linux", "zone": "dev"}

# Secure registration settings
CERTIFICATE_PATH = os.path.join(AGENT_HOME, "..", "agent.crt")
PRIVATE_KEY_PATH = os.path.join(AGENT_HOME, "..", "agent.key")

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

def generate_private_key():
    if not CRYPTO_AVAILABLE:
        raise Exception("cryptography library not available")
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)

def generate_csr(private_key, agent_id: str) -> str:
    if not CRYPTO_AVAILABLE:
        raise Exception("cryptography library not available")
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, agent_id),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Agentic Agent"),
    ])
    csr = x509.CertificateSigningRequestBuilder().subject_name(
        subject
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName(agent_id),
        ]),
        critical=False,
    ).sign(private_key, hashes.SHA256())
    return csr.public_bytes(serialization.Encoding.PEM).decode()

def save_certificate(certificate_pem: str, private_key):
    with open(CERTIFICATE_PATH, 'w') as f:
        f.write(certificate_pem)
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    with open(PRIVATE_KEY_PATH, 'wb') as f:
        f.write(private_key_pem)
    print(f"[agent] Certificate saved to {CERTIFICATE_PATH}", flush=True)
    print(f"[agent] Private key saved to {PRIVATE_KEY_PATH}", flush=True)

def load_certificate():
    try:
        with open(CERTIFICATE_PATH, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return None

def is_certificate_valid():
    cert_pem = load_certificate()
    if not cert_pem or not CRYPTO_AVAILABLE:
        return False
    try:
        cert = x509.load_pem_x509_certificate(cert_pem.encode())
        return datetime.utcnow() < cert.not_valid_after
    except Exception:
        return False

def _secure_register():
    if not CRYPTO_AVAILABLE:
        print("[agent] Secure registration requires cryptography library", flush=True)
        return False
    if is_certificate_valid():
        print("[agent] Valid certificate already exists, skipping registration", flush=True)
        return True
    try:
        announce_body = {
            "agent_id": AGENT_ID,
            "name": AGENT_ID,
            "url": SELF_URL,
            "labels": AGENT_LABELS,
        }
        print("[agent] Announcing to router...", flush=True)
        r = requests.post(f"{ROUTER_URL}/agents/announce", json=announce_body, timeout=10)
        if r.status_code != 200:
            print(f"[agent] Announce failed: {r.status_code} {r.text}", flush=True)
            return False
        announce_resp = r.json()
        otp = announce_resp.get("otp")
        if not otp:
            print("[agent] No OTP received from announce", flush=True)
            return False
        print(f"[agent] Received OTP, state: {announce_resp.get('state')}", flush=True)
        print("[agent] Generating private key and CSR...", flush=True)
        private_key = generate_private_key()
        csr_pem = generate_csr(private_key, AGENT_ID)
        enroll_body = {
            "agent_id": AGENT_ID,
            "otp": otp,
            "csr": csr_pem
        }
        print("[agent] Enrolling with CSR...", flush=True)
        r = requests.post(f"{ROUTER_URL}/agents/enroll", json=enroll_body, timeout=10)
        if r.status_code != 200:
            print(f"[agent] Enroll failed: {r.status_code} {r.text}", flush=True)
            return False
        enroll_resp = r.json()
        certificate = enroll_resp.get("certificate")
        if not certificate:
            print("[agent] No certificate received from enroll", flush=True)
            return False
        save_certificate(certificate, private_key)
        print(f"[agent] Enrolled successfully, state: {enroll_resp.get('state')}", flush=True)
        return True
    except Exception as e:
        print(f"[agent] Secure registration failed: {e}", flush=True)
        return False

def _auto_register_forever():
    if not CRYPTO_AVAILABLE:
        print("[agent] ERROR: Cryptography library required for secure registration", flush=True)
        return
    ok = _secure_register()
    delay = 60 if ok else 10
    while True:
        time.sleep(delay)
        ok = _secure_register()
        delay = 60 if ok else 10

# Use bash if available, otherwise sh
SHELL = "/bin/bash" if shutil.which("bash") else "/bin/sh"

# Ensure workspace exists
os.makedirs(AGENT_HOME, exist_ok=True)

app = Flask(__name__)


# =========================
# Helpers
# =========================
def _alive(pid: int, job_id: str = None) -> bool:
    """
    Check if a PID is alive and, if job_id is provided, verify it's the same process
    that was originally started for this job (by comparing process start time).
    """
    try:
        p = psutil.Process(pid)
        try:
            if getattr(psutil, "STATUS_ZOMBIE", None) and p.status() == psutil.STATUS_ZOMBIE:
                return False
        except Exception:
            pass
        
        # If job_id is provided, validate this is the same process that was started
        if job_id:
            home = os.path.join(AGENT_HOME, job_id)
            started_at_file = os.path.join(home, "started_at")
            
            if os.path.exists(started_at_file):
                try:
                    # Read job start time (Unix timestamp)
                    with open(started_at_file, "r") as f:
                        job_start_time = int(f.read().strip())
                    
                    # Get process start time
                    process_start_time = int(p.create_time())
                    
                    # Allow some tolerance (5 seconds) for timing differences
                    time_diff = abs(process_start_time - job_start_time)
                    if time_diff > 5:
                        print(f"[agent] PID {pid} for job {job_id} appears to be different process (time diff: {time_diff}s)", flush=True)
                        return False
                        
                except Exception as e:
                    print(f"[agent] Failed to validate PID {pid} for job {job_id}: {e}", flush=True)
                    # If we can't validate, assume it's not the same process
                    return False
        
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


def _cleanup_orphaned_job(job_id: str, reason: str = "Process no longer exists"):
    """
    Mark an orphaned job as FAILED and create the necessary completion files.
    """
    try:
        home = os.path.join(AGENT_HOME, job_id)
        logp = os.path.join(home, "run.log")
        rcp = os.path.join(home, "rc")
        finished_at_file = os.path.join(home, "finished_at")
        statusp = os.path.join(home, "status.txt")
        
        # Write failure reason to log
        _writeln(logp, f"[agent] Job marked as FAILED: {reason}\n")
        _writeln(logp, f"[agent] status=FAILED\n")
        
        # Create rc file with error code
        _write_text(rcp, "130")  # 130 = process terminated by signal
        
        # Create finished_at timestamp
        current_time = str(int(time.time()))
        _write_text(finished_at_file, current_time)
        
        # Update status file
        _write_text(statusp, "FAILED")
        
        print(f"[agent] Cleaned up orphaned job {job_id}: {reason}", flush=True)
        
    except Exception as e:
        print(f"[agent] Failed to cleanup orphaned job {job_id}: {e}", flush=True)


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
                      json={"agent_id": AGENT_ID, "url": SELF_URL, "labels": AGENT_LABELS},
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
                          json={"agent_id": AGENT_ID, "url": SELF_URL, "labels": AGENT_LABELS},
                          timeout=10)
        print("auto-register:", r.status_code, r.text[:120], flush=True)
    except Exception as e:
        print("auto-register failed:", e, flush=True)


# on startup
_send_hello()
_reconcile_and_report()
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



    # Build robust, POSIX-compliant detachment command (without setsid dependency)
    start_time_file = os.path.join(home, "started_at")
    finish_time_file = os.path.join(home, "finished_at")
    
    # Record start timestamp and run command, then record finish timestamp  
    # Use Unix timestamp to avoid quoting issues, convert to readable format later
    # Fix: Use shlex.quote for the entire command to avoid nested quote issues
    core = f"cd {shlex.quote(home)} || exit 255; date -u +%s > {shlex.quote(start_time_file)}; {cmd}; RC=$?; echo $RC > {shlex.quote(rcp)}; date -u +%s > {shlex.quote(finish_time_file)}; exit $RC"
    launch = f"setsid nohup bash -c {shlex.quote(core)} >> {shlex.quote(logp)} 2>&1 & echo $! > {shlex.quote(pidp)}"
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
    start_time_file = os.path.join(home, "started_at")
    finish_time_file = os.path.join(home, "finished_at")

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
            
    def _read_timestamp(filepath):
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                unix_ts = f.read().strip()
                if unix_ts:
                    # Convert Unix timestamp to YYYY-MM-DD HH:MM:SS format
                    import datetime
                    dt = datetime.datetime.fromtimestamp(int(unix_ts), tz=datetime.timezone.utc)
                    return dt.strftime('%Y-%m-%d %H:%M:%S')
                return None
        except Exception:
            return None

    if os.path.exists(rcp):
        try:
            rc = int(open(rcp, "r", encoding="utf-8", errors="ignore").read().strip())
        except Exception:
            rc = 1
        status_val = "SUCCEEDED" if rc == 0 else "FAILED"
        if _last_status() != status_val:
            _writeln(logp, f"[agent] status={status_val}\n")
            _write_status(status_val)
        
        # Include timing data
        response = {"status": status_val, "job_id": job_id, "log_path": logp, "rc": rc}
        started_at = _read_timestamp(start_time_file)
        finished_at = _read_timestamp(finish_time_file)
        if started_at:
            response["started_at"] = started_at
        if finished_at:
            response["finished_at"] = finished_at
        return jsonify(response)

    # If no rc yet, only then check pid/alive with job validation
    if pid and _alive(pid, job_id):
        if _last_status() != "RUNNING":
            _writeln(logp, f"[agent] status=RUNNING\n")
            _write_status("RUNNING")
        
        # Include start timing data for running job
        response = {"status": "RUNNING", "job_id": job_id, "log_path": logp, "rc": None}
        started_at = _read_timestamp(start_time_file)
        if started_at:
            response["started_at"] = started_at
        return jsonify(response)
    
    # If we have a PID but process is not alive or not the same process, cleanup
    elif pid:
        _cleanup_orphaned_job(job_id, "Process validation failed - likely container restart")
        # Re-read the rc file that was just created
        if os.path.exists(rcp):
            try:
                rc = int(open(rcp, "r", encoding="utf-8", errors="ignore").read().strip())
            except Exception:
                rc = 130
            status_val = "FAILED"
            
            response = {"status": status_val, "job_id": job_id, "log_path": logp, "rc": rc}
            started_at = _read_timestamp(start_time_file)
            finished_at = _read_timestamp(finish_time_file)
            if started_at:
                response["started_at"] = started_at
            if finished_at:
                response["finished_at"] = finished_at
            return jsonify(response)

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


@app.post("/stop/<job_id>")
def stop_job(job_id: str):
    """
    Stop a running job by sending SIGTERM to the process
    Called by Router when Airflow task is marked as failed
    """
    if request.headers.get("X-Agent-Token") != AGENT_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(force=True) or {}
    force = data.get("force", False)
    reason = data.get("reason", "Job termination requested")

    home = os.path.join(AGENT_HOME, job_id)
    pidp = os.path.join(home, "pid")
    logp = os.path.join(home, "run.log")
    rcp = os.path.join(home, "rc")
    finished_at_file = os.path.join(home, "finished_at")

    # Check if job directory exists
    if not os.path.exists(home):
        return jsonify({
            "error": "job_not_found",
            "message": f"Job {job_id} not found on this agent"
        }), 404

    # Check if job is already completed
    if os.path.exists(rcp):
        try:
            rc = int(open(rcp, "r", encoding="utf-8", errors="ignore").read().strip())
            status = "SUCCEEDED" if rc == 0 else "FAILED"
            return jsonify({
                "ok": True,
                "message": f"Job {job_id} already completed with status {status}",
                "status": status,
                "rc": rc,
                "action": "none"
            })
        except Exception:
            pass

    # Get PID and check if process is running
    pid = None
    if os.path.exists(pidp):
        try:
            pid = int(open(pidp, "r", encoding="utf-8", errors="ignore").read().strip())
        except Exception:
            pid = None

    if pid and _alive(pid, job_id):
        # Process is running, attempt to terminate it
        try:
            import signal
            
            _writeln(logp, f"[agent] Termination requested: {reason}\n")
            
            if force:
                # Send SIGKILL for immediate termination
                os.kill(pid, signal.SIGKILL)
                _writeln(logp, f"[agent] Sent SIGKILL to PID {pid}\n")
                signal_sent = "SIGKILL"
            else:
                # Send SIGTERM for graceful termination
                os.kill(pid, signal.SIGTERM)
                _writeln(logp, f"[agent] Sent SIGTERM to PID {pid}\n")
                signal_sent = "SIGTERM"
            
            # Wait a moment to see if process terminates
            time.sleep(0.5)
            
            # Check if process is still alive
            still_alive = _alive(pid, job_id)
            
            if not still_alive:
                # Process terminated, create completion files
                _write_text(rcp, "143")  # 143 = terminated by SIGTERM
                current_time = str(int(time.time()))
                _write_text(finished_at_file, current_time)
                _writeln(logp, f"[agent] Process terminated successfully\n")
                _writeln(logp, f"[agent] status=FAILED\n")
                
                return jsonify({
                    "ok": True,
                    "message": f"Job {job_id} terminated successfully",
                    "status": "FAILED",
                    "rc": 143,
                    "action": "terminated",
                    "signal": signal_sent,
                    "reason": reason
                })
            else:
                return jsonify({
                    "ok": True,
                    "message": f"Termination signal sent to job {job_id}",
                    "status": "RUNNING",
                    "action": "signal_sent",
                    "signal": signal_sent,
                    "warning": "Process may still be running",
                    "reason": reason
                })
                
        except ProcessLookupError:
            # Process already terminated
            _cleanup_orphaned_job(job_id, f"Process terminated: {reason}")
            return jsonify({
                "ok": True,
                "message": f"Job {job_id} process was already terminated",
                "status": "FAILED",
                "rc": 143,
                "action": "cleanup",
                "reason": reason
            })
        except PermissionError:
            _writeln(logp, f"[agent] Permission denied when trying to terminate PID {pid}\n")
            return jsonify({
                "error": "permission_denied",
                "message": f"Cannot terminate job {job_id}: permission denied",
                "reason": reason
            }), 403
        except Exception as e:
            _writeln(logp, f"[agent] Error terminating process: {e}\n")
            return jsonify({
                "error": "termination_failed",
                "message": f"Failed to terminate job {job_id}: {str(e)}",
                "reason": reason
            }), 500
    
    elif pid:
        # PID file exists but process is not alive (orphaned)
        _cleanup_orphaned_job(job_id, f"Orphaned job cleanup: {reason}")
        return jsonify({
            "ok": True,
            "message": f"Job {job_id} was orphaned, marked as failed",
            "status": "FAILED",
            "rc": 130,
            "action": "cleanup",
            "reason": reason
        })
    
    else:
        # No PID file, job never started properly
        _cleanup_orphaned_job(job_id, f"Job never started properly: {reason}")
        return jsonify({
            "ok": True,
            "message": f"Job {job_id} never started properly, marked as failed",
            "status": "FAILED", 
            "rc": 255,
            "action": "cleanup",
            "reason": reason
        })



# =========================
# Secure registration logic
# =========================
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    print("[agent] Warning: cryptography library not available, secure registration disabled", flush=True)

CERTIFICATE_PATH = os.path.join(AGENT_HOME, "..", "agent.crt")
PRIVATE_KEY_PATH = os.path.join(AGENT_HOME, "..", "agent.key")

def generate_private_key():
    if not CRYPTO_AVAILABLE:
        raise Exception("cryptography library not available")
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)

def generate_csr(private_key, agent_id: str) -> str:
    if not CRYPTO_AVAILABLE:
        raise Exception("cryptography library not available")
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, agent_id),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Agentic Agent"),
    ])
    csr = x509.CertificateSigningRequestBuilder().subject_name(subject).add_extension(
        x509.SubjectAlternativeName([x509.DNSName(agent_id)]), critical=False
    ).sign(private_key, hashes.SHA256())
    return csr.public_bytes(serialization.Encoding.PEM).decode()

def save_certificate(certificate_pem: str, private_key):
    with open(CERTIFICATE_PATH, 'w') as f:
        f.write(certificate_pem)
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    with open(PRIVATE_KEY_PATH, 'wb') as f:
        f.write(private_key_pem)
    print(f"[agent] Certificate saved to {CERTIFICATE_PATH}", flush=True)
    print(f"[agent] Private key saved to {PRIVATE_KEY_PATH}", flush=True)

def load_certificate():
    try:
        with open(CERTIFICATE_PATH, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return None

def is_certificate_valid():
    cert_pem = load_certificate()
    if not cert_pem or not CRYPTO_AVAILABLE:
        return False
    try:
        cert = x509.load_pem_x509_certificate(cert_pem.encode())
        from datetime import datetime
        return datetime.utcnow() < cert.not_valid_after
    except Exception:
        return False


def _secure_register():
    if not CRYPTO_AVAILABLE:
        print("[agent] Secure registration requires cryptography library", flush=True)
        return False
    if is_certificate_valid():
        print("[agent] Valid certificate already exists, skipping registration", flush=True)
        return True
    try:
        announce_body = {
            "agent_id": AGENT_ID,
            "name": AGENT_ID,
            "url": SELF_URL,
            "labels": AGENT_LABELS,
        }
        print("[agent] Announcing to router...", flush=True)
        r = requests.post(f"{ROUTER_URL}/agents/announce", json=announce_body, timeout=10)
        if r.status_code != 200:
            print(f"[agent] Announce failed: {r.status_code} {r.text}", flush=True)
            return False
        announce_resp = r.json()
        otp = announce_resp.get("otp")
        if not otp:
            print("[agent] No OTP received from announce", flush=True)
            return False
        print(f"[agent] Received OTP, state: {announce_resp.get('state')}", flush=True)
        private_key = generate_private_key()
        csr_pem = generate_csr(private_key, AGENT_ID)
        enroll_body = {
            "agent_id": AGENT_ID,
            "otp": otp,
            "csr": csr_pem
        }
        print("[agent] Enrolling with CSR...", flush=True)
        r = requests.post(f"{ROUTER_URL}/agents/enroll", json=enroll_body, timeout=10)
        if r.status_code != 200:
            print(f"[agent] Enroll failed: {r.status_code} {r.text}", flush=True)
            return False
        enroll_resp = r.json()
        certificate = enroll_resp.get("certificate")
        if not certificate:
            print("[agent] No certificate received from enroll", flush=True)
            return False
        save_certificate(certificate, private_key)
        print(f"[agent] Enrolled successfully, state: {enroll_resp.get('state')}", flush=True)
        return True
    except Exception as e:
        print(f"[agent] Secure registration failed: {e}", flush=True)
        return False

_secure_register()  # Start secure registration immediately on agent startup

# =========================
# Main
# =========================
if __name__ == "__main__":
    # Bind to 0.0.0.0:8001 (match SELF_URL port and your compose exposure)
    app.run(host="0.0.0.0", port=8001)
