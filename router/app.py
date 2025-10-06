import os, json, uuid, requests
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional

from flask import Flask, request, jsonify
from flask_restx import Api, Resource, fields
from sqlalchemy import create_engine, Column, String, Text, Integer, DateTime, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker

# -----------------------------
# Config
# -----------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:////data/db.sqlite")
ROUTER_TOKEN = os.environ.get("ROUTER_TOKEN", "router-secret")
AGENT_TOKEN  = os.environ.get("AGENT_TOKEN",  "agent-secret")

# -----------------------------
# DB setup
# -----------------------------
Base = declarative_base()
engine = create_engine(DATABASE_URL, echo=False, future=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)

def now_utc() -> datetime:
    # store naive UTC for compatibility with existing rows
    return datetime.utcnow()

class Job(Base):
    __tablename__ = "jobs"
    job_id     = Column(String, primary_key=True)
    status     = Column(String, default="QUEUED")  # QUEUED | RUNNING | SUCCEEDED | FAILED
    agent_id   = Column(String, nullable=True)
    labels     = Column(Text, nullable=True)       # JSON string
    payload    = Column(Text, nullable=True)       # JSON string (job spec)
    priority   = Column(Integer, default=5)
    rc         = Column(Integer, nullable=True)
    note       = Column(Text, nullable=True)
    log_path   = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)

class Agent(Base):
    __tablename__ = "agents"
    agent_id   = Column(String, primary_key=True)
    url        = Column(Text, nullable=False)      # e.g. http://agent_vm1:8001
    labels     = Column(Text, nullable=True)       # JSON string
    active     = Column(Boolean, default=True)
    last_heartbeat = Column(DateTime, default=now_utc, onupdate=now_utc)

Base.metadata.create_all(engine)

# -----------------------------
# App & Swagger Setup
# -----------------------------
app = Flask(__name__)

# Initialize Flask-RESTX for Swagger (minimal setup to avoid conflicts)
api = Api(
    app,
    version='1.0',
    title='Agentic Router API',
    description='API for managing distributed job execution across agents',
    doc='/swagger/',  # Swagger UI will be available at /swagger/
    contact_email='support@agentic.dev',
    add_specs=False,  # Disable automatic spec endpoint to avoid conflicts
    authorizations={
        'Bearer': {
            'type': 'apiKey',
            'in': 'header',
            'name': 'Authorization',
            'description': 'Bearer token for API authentication. Use: Bearer <router-secret>'
        }
    },
    security='Bearer'
)

# Define API models for Swagger documentation
agent_model = api.model('Agent', {
    'agent_id': fields.String(required=True, description='Unique identifier for the agent'),
    'url': fields.String(required=True, description='Agent endpoint URL (e.g., http://agent_vm1:8001)'),
    'labels': fields.Raw(description='Key-value pairs for agent labels (JSON object)'),
    'active': fields.Boolean(description='Whether the agent is registered and active'),
    'last_heartbeat': fields.DateTime(description='Last heartbeat timestamp from agent')
})

job_model = api.model('Job', {
    'job_id': fields.String(description='Unique identifier for the job'),
    'status': fields.String(description='Job status: QUEUED, RUNNING, SUCCEEDED, or FAILED'),
    'agent_id': fields.String(description='Agent executing this job'),
    'rc': fields.Integer(description='Exit code (for completed jobs)'),
    'priority': fields.Integer(description='Job priority (higher numbers = higher priority)'),
    'note': fields.String(description='Additional notes or error messages'),
    'labels': fields.Raw(description='Job labels for routing (JSON object)'),
    'log_path': fields.String(description='Path to job logs on the agent'),
    'created_at': fields.DateTime(description='Job creation timestamp'),
    'updated_at': fields.DateTime(description='Last job update timestamp')
})

job_submit_model = api.model('JobSubmit', {
    'job': fields.Raw(required=True, description='Job specification (command, environment, etc.)'),
    'route': fields.Nested(api.model('JobRoute', {
        'agent_id': fields.String(description='Target specific agent by ID'),
        'labels': fields.Raw(description='Route by agent labels (JSON object)')
    }), description='Routing specification - either agent_id OR labels')
})

agent_register_model = api.model('AgentRegister', {
    'agent_id': fields.String(required=True, description='Unique agent identifier'),
    'url': fields.String(required=True, description='Agent endpoint URL'),
    'labels': fields.Raw(description='Agent capability labels (JSON object)')
})

@app.errorhandler(Exception)
def _json_errors(e):
    try:
        app.logger.exception("Unhandled error")
    except Exception:
        pass
    return jsonify({"error":"internal_error","detail":str(e)}), 500

# CORS for the browser UI
try:
    from flask_cors import CORS
    CORS(app, resources={r"/*": {
        "origins": "*",
        "allow_headers": ["Content-Type", "Authorization"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    }})
except Exception:
    pass

# -----------------------------
# Helpers
# -----------------------------
def auth_ok(req) -> bool:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    return auth.split(" ", 1)[1] == ROUTER_TOKEN

def labels_match(agent_labels: Dict[str, Any], job_labels: Dict[str, Any]) -> bool:
    if not job_labels:
        return True
    if not agent_labels:
        return False
    for k, v in job_labels.items():
        if agent_labels.get(k) != v:
            return False
    return True

def pick_agent_by_labels(session, labels: Dict[str, Any]) -> Optional['Agent']:
    agents = session.query(Agent).filter(Agent.active == True).all()
    for a in agents:
        try:
            al = json.loads(a.labels or "{}")
        except Exception:
            al = {}
        if labels_match(al, labels or {}):
            return a
    return None

def _coerce_json(value, default):
    """
    Return a Python object from a DB field that may be JSON text, bytes,
    already a dict/list, None, or even a wrong primitive (int/float).
    """
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        s = value.decode("utf-8", "ignore").strip()
    elif isinstance(value, str):
        s = value.strip()
    else:
        # wrong primitive (e.g. int/float); just fall back
        return default
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default

# -----------------------------
# Endpoints
# -----------------------------
@app.post("/agents/deregister")
def agents_deregister():
    if not auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True) or {}
    agent_id = (data.get("agent_id") or "").strip()
    if not agent_id:
        return jsonify({"error": "agent_id required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if not a:
            return jsonify({"error": "agent not found"}), 404
        a.active = False
        s.commit()
    return jsonify({"ok": True, "agent_id": agent_id})
@api.route('/health')
class Health(Resource):
    @api.doc('health_check')
    @api.marshal_with(api.model('Health', {
        'ok': fields.Boolean(description='Service health status'),
        'db': fields.Boolean(description='Database connectivity status')
    }))
    def get(self):
        """Health check endpoint"""
        return {"ok": True, "db": True}

# Root route is handled by Flask-RESTX automatically


@app.post("/agents/hello")
def agents_hello():
    # discovery: record/update agent as not registered yet
    data = request.get_json(force=True) or {}
    agent_id = (data.get("agent_id") or "").strip()
    url = (data.get("url") or "").strip()
    labels = data.get("labels") or {}
    if not agent_id or not url:
        return jsonify({"error":"agent_id and url required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if not a:
            a = Agent(agent_id=agent_id, url=url, active=False)
            s.add(a)
        a.url = url
        try:
            a.labels = json.dumps(labels)
        except Exception:
            a.labels = "{}"
        a.last_heartbeat = now_utc()
        s.commit()
    return jsonify({"ok": True})

@app.post("/agents/heartbeat")
def agents_heartbeat():
    data = request.get_json(force=True) or {}
    agent_id = (data.get("agent_id") or "").strip()
    if not agent_id:
        return jsonify({"error":"agent_id required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if not a:
            a = Agent(agent_id=agent_id, url=data.get("url") or "", active=False)
            s.add(a)
        a.last_heartbeat = now_utc()
        s.commit()
    return jsonify({"ok": True, "ts": now_utc().isoformat()})

def _serialize_agent(a):
    try:
        labels = json.loads(a.labels or "{}")
    except Exception:
        labels = {}
    return {
        "agent_id": a.agent_id,
        "url": a.url,
        "labels": labels,
        "active": bool(a.active),
        "last_heartbeat": a.last_heartbeat.isoformat() if a.last_heartbeat else None,
    }

def _agents_filtered(active=None):
    out = []
    with Session() as s:
        q = s.query(Agent)
        if active is not None:
            q = q.filter(Agent.active == (1 if active else 0))
        for a in q.order_by(Agent.last_heartbeat.desc()).all():
            out.append(_serialize_agent(a))
    return jsonify({"agents": out})

@api.route('/agents')
class AgentList(Resource):
    @api.doc('list_agents', security='Bearer')
    @api.param('state', 'Filter by agent state: registered, discovered', type='string')
    @api.param('active', 'Filter by active status: true, false', type='boolean')
    @api.marshal_with(api.model('AgentListResponse', {
        'agents': fields.List(fields.Nested(agent_model))
    }))
    def get(self):
        """List all agents with optional filtering"""
        if not auth_ok(request):
            api.abort(401, "Unauthorized")
        
        # Filters: /agents?state=registered|discovered or /agents?active=true|false
        state = (request.args.get("state") or "").lower().strip()
        active_param = request.args.get("active")
        active = None
        if state in ("registered", "active", "enabled"):
            active = True
        elif state in ("discovered", "inactive", "disabled"):
            active = False
        elif active_param is not None:
            active = str(active_param).lower() in ("1","true","yes","y")
        
        if active is not None:
            return _agents_filtered(active=active)
        
        # default: return all
        out = []
        with Session() as s:
            for a in s.query(Agent).order_by(Agent.last_heartbeat.desc()).all():
                out.append(_serialize_agent(a))
        return {"agents": out}
@app.get("/agents/discovered")
def agents_discovered():
    if not auth_ok(request):
        return jsonify({"error":"unauthorized"}), 401
    return _agents_filtered(active=False)


def list_agents():
    if not auth_ok(request):
        return jsonify({"error":"unauthorized"}), 401
    # Optional filters: /agents?state=registered|discovered or /agents?active=true|false
    state = (request.args.get("state") or "").lower().strip()
    active_param = request.args.get("active")
    active = None
    if state in ("registered", "active", "enabled"):
        active = True
    elif state in ("discovered", "inactive", "disabled"):
        active = False
    elif active_param is not None:
        active = str(active_param).lower() in ("1","true","yes","y")
    if active is not None:
        return _agents_filtered(active=active)
    # default: return all
    out = []
    with Session() as s:
        for a in s.query(Agent).order_by(Agent.last_heartbeat.desc()).all():
            out.append(_serialize_agent(a))
    return jsonify({"agents": out})
@app.post("/agents/register")
def agents_register():
    if request.headers.get("X-Agent-Token") != AGENT_TOKEN:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True) or {}
    agent_id = data.get("agent_id")
    url = data.get("url")
    labels = data.get("labels") or {}
    if not agent_id or not url:
        return jsonify({"error": "agent_id and url required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if not a:
            a = Agent(agent_id=agent_id, url=url)
        a.url = url
        a.labels = json.dumps(labels)
        a.active = True
        a.last_heartbeat = now_utc()
        s.add(a)
        s.commit()
    return jsonify({"ok": True, "agent_id": agent_id})

@app.post("/submit")
@api.doc('submit_job', security='Bearer')
@api.expect(job_submit_model)
@api.marshal_with(api.model('JobSubmitResponse', {
    'job_id': fields.String(description='Unique job identifier'),
    'status': fields.String(description='Initial job status'),
    'rc': fields.Integer(description='Return code (if failed immediately)'),
    'note': fields.String(description='Additional notes'),
    'agent_id': fields.String(description='Assigned agent ID'),
    'log_path': fields.String(description='Log file path on agent')
}))
def submit():
    """Submit a new job for execution"""
    
    # Check authorization
    if not auth_ok(request):
        return {"error":"unauthorized"}, 401

    data = request.get_json(force=True) or {}
    job_spec = (data.get("job") or {})
    route    = (data.get("route") or {})
    labels   = (route.get("labels") or {})
    target_agent_id = (route.get("agent_id") or "").strip()

    # Create job row
    jid = str(uuid.uuid4())
    with Session() as s:
        j = Job(
            job_id=jid,
            status="QUEUED",
            labels=json.dumps(labels),
            payload=json.dumps(job_spec),
            priority=int(job_spec.get("priority", 5)),
            created_at=now_utc(),
            updated_at=now_utc(),
        )
        s.add(j); s.commit()

    # Choose agent
    with Session() as s:
        if target_agent_id:
            agent = s.get(Agent, target_agent_id)
            if not agent or not agent.active:
                j = s.get(Job, jid)
                j.status = "FAILED"; j.rc = 127
                j.note = "agent not found or inactive"
                j.updated_at = now_utc(); s.commit()
                return {"job_id": jid, "status":"FAILED", "note":"agent not found or inactive"}, 400
        else:
            agent = pick_agent_by_labels(s, labels)
            if not agent:
                j = s.get(Job, jid)
                j.status = "FAILED"; j.rc = 127
                j.note = "no suitable agent"
                j.updated_at = now_utc(); s.commit()
                return {"job_id": jid, "status":"FAILED", "note":"no suitable agent"}, 200

    # Dispatch
    try:
        r = requests.post(
            f"{agent.url.rstrip('/')}/run",
            headers={"X-Agent-Token": AGENT_TOKEN},
            json={"job_id": jid, "payload": job_spec},
            timeout=15
        )
        if r.status_code == 200:
            out = r.json()
            with Session() as s:
                j = s.get(Job, jid)
                j.status   = "RUNNING"
                j.agent_id = agent.agent_id
                j.log_path = out.get("log_path")
                j.updated_at = now_utc()
                s.commit()
        else:
            with Session() as s:
                j = s.get(Job, jid)
                j.status = "FAILED"
                j.rc = 255
                j.note = f"dispatch failed: http {r.status_code} {r.text[:200]}"
                j.agent_id = agent.agent_id
                j.updated_at = now_utc()
                s.commit()
    except Exception as e:
        with Session() as s:
            j = s.get(Job, jid)
            j.status = "FAILED"; j.rc = 255
            j.note = f"dispatch error: {e}"
            j.agent_id = agent.agent_id
            j.updated_at = now_utc()
            s.commit()

    # Return current job row
    with Session() as s:
        j = s.get(Job, jid)
        return {
            "job_id": j.job_id,
            "status": j.status,
            "rc": j.rc,
            "note": j.note,
            "agent_id": j.agent_id,
            "log_path": j.log_path
        }
@app.get("/status/<job_id>")
@api.doc('get_job_status', security='Bearer')
@api.param('job_id', 'Job identifier', required=True)
@api.marshal_with(api.model('JobStatusResponse', {
    'job_id': fields.String(description='Job identifier'),
    'status': fields.String(description='Current job status'),
    'rc': fields.Integer(description='Exit code'),
    'agent_id': fields.String(description='Agent executing the job'),
    'log_path': fields.String(description='Path to job logs'),
    'note': fields.String(description='Additional information')
}))
def status(job_id: str):
    """Get job status and details"""
    import sys
    if not auth_ok(request):
        return {"error":"unauthorized"}, 401

    with Session() as s:
        j = s.get(Job, job_id)
        if not j:
            return {"error":"not found"}, 404
        agent = s.get(Agent, j.agent_id) if j.agent_id else None

    if not agent:
        # optional: probe all agents to locate job
        with Session() as s:
            agents = s.query(Agent).filter(Agent.active == True).all()
        for a in agents:
            try:
                r = requests.get(f"{a.url.rstrip('/')}/status/{job_id}",
                                 headers={"X-Agent-Token": AGENT_TOKEN}, timeout=5)
                if r.status_code == 200:
                    agent = a
                    break
            except Exception:
                continue

    if not agent:
        with Session() as s:
            j = s.get(Job, job_id)
            print(f"[ROUTER DEBUG] No agent found for job {job_id}, returning DB status={j.status} rc={j.rc}", file=sys.stderr)
            return {
                "job_id": j.job_id, "status": j.status, "rc": j.rc,
                "agent_id": j.agent_id, "log_path": j.log_path, "note": j.note
            }

    try:
        agent_resp = requests.get(f"{agent.url.rstrip('/')}/status/{job_id}",
                                  headers={"X-Agent-Token": AGENT_TOKEN}, timeout=10)
    except Exception as e:
        with Session() as s:
            j = s.get(Job, job_id)
            j.status = "FAILED"; j.rc = 255
            j.note = f"agent status probe failed: {e}"
            j.updated_at = now_utc(); s.commit()
        with Session() as s:
            j = s.get(Job, job_id)
            print(f"[ROUTER DEBUG] Agent probe failed for job {job_id}, status={j.status} rc={j.rc}", file=sys.stderr)
            return {
                "job_id": j.job_id, "status": j.status, "rc": j.rc,
                "agent_id": j.agent_id, "log_path": j.log_path, "note": j.note
            }

    with Session() as s:
        j = s.get(Job, job_id)
        print(f"[ROUTER DEBUG] Agent response for job {job_id}: HTTP {agent_resp.status_code}", file=sys.stderr)
        try:
            st = agent_resp.json()
            print(f"[ROUTER DEBUG] Agent JSON: {st}", file=sys.stderr)
        except Exception as e:
            print(f"[ROUTER DEBUG] Failed to parse agent JSON for job {job_id}: {e}", file=sys.stderr)
            st = {}
        if agent_resp.status_code == 200:
            if st.get("status") in ("SUCCEEDED", "FAILED"):
                print(f"[ROUTER DEBUG] Updating DB for job {job_id}: status={st.get('status')} rc={st.get('rc')}", file=sys.stderr)
                j.status = st["status"]
                try:
                    rc_val = st.get("rc", 1)
                    j.rc = int(rc_val) if rc_val is not None else 1
                except Exception as e:
                    print(f"[ROUTER DEBUG] RC cast error for job {job_id}: {e}, value={st.get('rc')}", file=sys.stderr)
                    j.rc = 1
                j.log_path = st.get("log_path", j.log_path)
                if not j.agent_id:
                    j.agent_id = agent.agent_id
                j.updated_at = now_utc(); s.commit()
            elif st.get("status") == "RUNNING":
                if not j.agent_id:
                    j.agent_id = agent.agent_id
                    j.updated_at = now_utc(); s.commit()
        elif agent_resp.status_code == 404:
            print(f"[ROUTER DEBUG] Agent 404 for job {job_id}", file=sys.stderr)
            j.status = "FAILED"; j.rc = 127
            j.note = "agent reports unknown job (404)"
            j.updated_at = now_utc(); s.commit()
        elif agent_resp.status_code == 401:
            print(f"[ROUTER DEBUG] Agent 401 for job {job_id}", file=sys.stderr)
            j.status = "FAILED"; j.rc = 401
            j.note = "agent unauthorized"
            j.updated_at = now_utc(); s.commit()

    with Session() as s:
        j = s.get(Job, job_id)
        print(f"[ROUTER DEBUG] Returning status for job {job_id}: status={j.status} rc={j.rc}", file=sys.stderr)
        return {
            "job_id": j.job_id,
            "status": j.status,
            "rc": j.rc,
            "agent_id": j.agent_id,
            "log_path": j.log_path,
            "note": j.note
        }

@app.get("/logs/<job_id>")
def logs(job_id: str):
    if not auth_ok(request):
        return jsonify({"error":"unauthorized"}), 401
    with Session() as s:
        j = s.get(Job, job_id)
        if not j:
            return jsonify({"error":"not found"}), 404
        if not j.agent_id:
            return jsonify({"error":"no agent"}), 400
        a = s.get(Agent, j.agent_id)
    try:
        r = requests.get(f"{a.url.rstrip('/')}/logs/{job_id}",
                         headers={"X-Agent-Token": AGENT_TOKEN}, timeout=10)
        return (r.text, r.status_code, {"Content-Type": r.headers.get("Content-Type","text/plain")})
    except Exception as e:
        return jsonify({"error": f"proxy failed: {e}"}), 502

@app.get("/jobs")
@api.doc('list_jobs', security='Bearer')
@api.param('limit', 'Maximum number of jobs to return', type='integer', default=200)
@api.param('status', 'Filter by job status (comma-separated)', type='string')
@api.param('agent_id', 'Filter by agent ID', type='string')
@api.param('since_hours', 'Only jobs created in the last N hours', type='integer')
@api.marshal_with(api.model('JobListResponse', {
    'jobs': fields.List(fields.Nested(job_model))
}))
def list_jobs():
    """List jobs with optional filtering"""
    if not auth_ok(request):
        return {"error":"unauthorized"}, 401
    # filters
    try:
        limit = int(request.args.get("limit", 200))
    except Exception:
        limit = 200
    status_filter = request.args.get("status")
    agent_id = request.args.get("agent_id")
    since_hours = request.args.get("since_hours")
    statuses = [s.strip().upper() for s in status_filter.split(",")] if status_filter else None

    out = []
    with Session() as s:
        q = s.query(Job)
        if statuses:
            q = q.filter(Job.status.in_(statuses))
        if agent_id:
            q = q.filter(Job.agent_id == agent_id)
        if since_hours:
            try:
                cutoff = datetime.utcnow() - timedelta(hours=int(since_hours))
                q = q.filter(Job.created_at >= cutoff)
            except Exception:
                pass
        q = q.order_by(Job.created_at.desc()).limit(limit)
        for j in q.all():
            out.append({
                "job_id": j.job_id,
                "status": j.status,
                "agent_id": j.agent_id,
                "rc": j.rc,
                "priority": j.priority,
                "note": j.note,
                "labels": _coerce_json(getattr(j,"labels",None), {}),
                "log_path": j.log_path,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "updated_at": j.updated_at.isoformat() if j.updated_at else None,
            })
    return {"jobs": out}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)

@app.get("/agents/stats")
def agents_stats():
    # Require same auth as other router endpoints
    try:
        ok = auth_ok(request)  # type: ignore[name-defined]
    except Exception:
        # Fallback: allow if no auth_ok helper exists
        ok = True
    if not ok:
        return jsonify({"error": "unauthorized"}), 401

    with Session() as s:  # type: ignore[name-defined]
        try:
            total = s.query(Agent).count()         # type: ignore[name-defined]
            registered = s.query(Agent).filter(Agent.active == True).count()  # noqa: E712
        except Exception:
            # If boolean vs int mismatch, treat nonzero as registered
            total = s.query(Agent).count()
            registered = sum(1 for a in s.query(Agent).all() if getattr(a, "active", 0))
        discovered = max(0, total - registered)
    return jsonify({"total": total, "registered": registered, "discovered": discovered})
