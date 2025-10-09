
# -----------------------------
# Imports
# -----------------------------
import os, json, uuid, requests, sys
import secrets
import base64
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional

from flask import Flask, request, jsonify, session
from flask_restx import Api, Resource, fields
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Job, Agent, now_utc

# Certificate and crypto utilities
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

# -----------------------------
# Config
# -----------------------------
# Database configuration - container path by default, can be overridden via env var
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:////data/db.sqlite")
ROUTER_TOKEN = os.environ.get("ROUTER_TOKEN", "router-secret")
AGENT_TOKEN  = os.environ.get("AGENT_TOKEN",  "agent-secret")
OTP_EXPIRY_MINUTES = int(os.environ.get("OTP_EXPIRY_MINUTES", "60"))  # OTP expires in 60 minutes

# -----------------------------
# DB setup
# -----------------------------
# Ensure database directory exists for SQLite DB
_db_path = DATABASE_URL.replace("sqlite://", "")
db_dir = os.path.dirname(_db_path)
if db_dir and not os.path.exists(db_dir):
    os.makedirs(db_dir, exist_ok=True)
engine = create_engine(DATABASE_URL, echo=False, future=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)
Base.metadata.create_all(engine)

# -----------------------------
# Utility: format_execution_time
# -----------------------------
def format_execution_time(started_at, finished_at, job_status=None):
    """Calculate and format execution time as human-readable string."""
    if not started_at:
        return "-"
    # Handle both datetime objects and timestamp strings for started_at
    if isinstance(started_at, str):
        try:
            started_at = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
        except:
            return "-"
    # For running jobs without finished_at, use current UTC time
    if not finished_at:
        # Only show running time if job is actually running
        if job_status == "RUNNING":
            finished_at = datetime.utcnow()
        else:
            return "-"
    else:
        # Handle datetime objects and timestamp strings for finished_at
        if isinstance(finished_at, str):
            try:
                finished_at = datetime.fromisoformat(finished_at.replace('Z', '+00:00'))
            except:
                return "-"
    # Ensure both timestamps are timezone-naive UTC for proper comparison
    if hasattr(started_at, 'tzinfo') and started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)
    if hasattr(finished_at, 'tzinfo') and finished_at.tzinfo is not None:
        finished_at = finished_at.astimezone(timezone.utc).replace(tzinfo=None)
    duration = finished_at - started_at
    total_seconds = int(duration.total_seconds())
    # Ensure we don't show negative time (in case of clock skew)
    if total_seconds < 0:
        return "-"
    if total_seconds < 60:
        return f"{total_seconds}s"
    elif total_seconds < 3600:
        minutes = total_seconds // 60
        seconds = total_seconds % 60
        return f"{minutes}m {seconds}s"
    else:
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        return f"{hours}h {minutes}m {seconds}s"

# -----------------------------
# App & Swagger Setup
# -----------------------------
app = Flask(__name__)

# Set secret key for sessions
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# Initialize authentication
from auth import init_auth, require_permission, login_required, user_has_permission, log_audit_event
init_auth(app)

# Initialize Flask-RESTX for Swagger (avoid root route conflicts)
api = Api(
    app,
    version='1.0',
    title='Agent Router API',
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

# Custom 404 handler to provide meaningful response for root endpoint
@app.errorhandler(404)
def not_found(error):
    """Custom 404 handler that provides API information for root requests"""
    # Check if the request is for the root path
    if request.path == '/':
        return jsonify({
            "service": "Agent Router API",
            "message": "Welcome to the Agent Router API",
            "version": "1.0",
            "documentation": "/swagger/",
            "status": "/status",
            "health": "/health",
            "endpoints": {
                "health": "/health",
                "agents": "/agents", 
                "jobs": "/jobs",
                "submit": "/submit",
                "status": "/status/<job_id>",
                "logs": "/logs/<job_id>",
                "router_status": "/status"
            }
        }), 200
    
    # For other 404s, return standard error
    return jsonify({
        "detail": f"404 Not Found: The requested URL {request.path} was not found on the server.",
        "error": "not_found"
    }), 404

# Define API models for Swagger documentation
agent_model = api.model('Agent', {
    'agent_id': fields.String(required=True, description='Unique identifier for the agent'),
    'name': fields.String(description='Human-readable agent name'),
    'url': fields.String(required=True, description='Agent endpoint URL (e.g., http://agent_vm1:8001)'),
    'labels': fields.Raw(description='Key-value pairs for agent labels (JSON object)'),
    'active': fields.Boolean(description='Whether the agent is registered and active'),
    'state': fields.String(description='Agent registration state'),
    'last_heartbeat': fields.DateTime(description='Last heartbeat timestamp from agent'),
    'has_certificate': fields.Boolean(description='Whether the agent has a certificate'),
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
    'dag_id': fields.String(description='DAG identifier (from Airflow) or "Not Applicable"'),
    'task_id': fields.String(description='Task identifier (from Airflow) or "Not Applicable"'),
    'created_at': fields.DateTime(description='Job creation timestamp'),
    'updated_at': fields.DateTime(description='Last job update timestamp'),
    'started_at': fields.DateTime(description='Job execution start timestamp'),
    'finished_at': fields.DateTime(description='Job execution completion timestamp'),
    'execution_time': fields.String(description='Human-readable execution duration (e.g., "2m 34s")')
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
    # Check for Bearer token authentication (for API clients)
    auth = req.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1] == ROUTER_TOKEN
    
    # Check for session authentication (for web UI)
    if 'user_id' in session:
        return True
    
    return False

def auth_ok_with_permission(req, resource: str, action: str = 'read') -> bool:
    """Check authentication and permission for a specific resource/action"""
    # Check for Bearer token authentication (for API clients) - full access
    auth = req.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        if auth.split(" ", 1)[1] == ROUTER_TOKEN:
            return True
    
    # Check for session authentication with permissions (for web UI)
    if 'user_id' in session:
        user_id = session['user_id']
        return user_has_permission(user_id, resource, action)
    
    return False

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
    # Only consider agents that are both active AND in REGISTERED state
    agents = session.query(Agent).filter(
        Agent.active == True,
        Agent.state == "REGISTERED"
    ).all()
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

def parse_agent_timestamp(timestamp_str):
    """Parse timestamp from agent (format: 'YYYY-MM-DD HH:MM:SS') to datetime object"""
    if not timestamp_str:
        print(f"[ROUTER DEBUG] parse_agent_timestamp: empty timestamp_str", file=sys.stderr)
        return None
    try:
        result = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
        print(f"[ROUTER DEBUG] parse_agent_timestamp: '{timestamp_str}' -> {result}", file=sys.stderr)
        return result
    except Exception as e:
        print(f"[ROUTER DEBUG] parse_agent_timestamp: failed to parse '{timestamp_str}': {e}", file=sys.stderr)
        return None

## --- Begin new agent registration logic --- ##
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
        if getattr(a, "state", None) != "REGISTERED":
            return jsonify({"error": "can only deregister agents in REGISTERED state"}), 400
        # Move agent back to NEW state and clear registration data
        a.state = "NEW"
        a.active = False
        a.certificate = None
        a.csr = None
        a.otp = None
        a.otp_expires_at = None
        s.commit()
    return jsonify({"ok": True, "agent_id": agent_id})

@app.post("/agents/announce")
def agents_announce():
    """Agent announces itself for registration (Step 1 of secure registration)"""
    data = request.get_json(force=True) or {}
    agent_id = (data.get("agent_id") or "").strip()
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    labels = data.get("labels") or {}
    if not agent_id or not url:
        return jsonify({"error": "agent_id and url required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if a and getattr(a, "state", None) == "REGISTERED":
            return jsonify({"error": "agent already registered"}), 409
        # Generate OTP
        import secrets
        otp = secrets.token_urlsafe(9)
        from datetime import datetime, timedelta
        otp_expires_at = datetime.utcnow() + timedelta(minutes=60)
        if not a:
            a = Agent(
                agent_id=agent_id,
                name=name or agent_id,
                url=url,
                state="PENDING_APPROVAL",
                otp=otp,
                otp_expires_at=otp_expires_at,
                active=False
            )
            s.add(a)
        else:
            a.name = name or agent_id
            a.url = url
            a.state = "PENDING_APPROVAL"
            a.otp = otp
            a.otp_expires_at = otp_expires_at
            a.active = False
        try:
            a.labels = json.dumps(labels)
        except Exception:
            a.labels = "{}"
        a.last_heartbeat = now_utc()
        s.commit()
    return jsonify({
        "ok": True,
        "otp": otp,
        "agent_id": agent_id,
        "state": "PENDING_APPROVAL"
    })

@app.post("/agents/enroll")
def agents_enroll():
    """Agent enrolls with OTP and CSR to receive certificate (Step 2 of secure registration)"""
    data = request.get_json(force=True) or {}
    agent_id = (data.get("agent_id") or "").strip()
    otp = (data.get("otp") or "").strip()
    csr = (data.get("csr") or "").strip()
    if not agent_id or not otp or not csr:
        return jsonify({"error": "agent_id, otp, and csr required"}), 400
    with Session() as s:
        a = s.get(Agent, agent_id)
        if not a:
            return jsonify({"error": "agent not found"}), 404
        if getattr(a, "state", None) != "PENDING_APPROVAL":
            return jsonify({"error": f"invalid state: {a.state}"}), 400
        if not a.otp or not a.otp_expires_at or datetime.utcnow() > a.otp_expires_at:
            return jsonify({"error": "OTP expired or invalid"}), 401
        if a.otp != otp:
            return jsonify({"error": "invalid OTP"}), 401
        try:
            # Generate certificate from CSR
            cert = None
            try:
                from cryptography import x509
                from cryptography.x509.oid import NameOID
                from cryptography.hazmat.primitives import hashes, serialization
                from cryptography.hazmat.primitives.asymmetric import rsa
                csr_obj = x509.load_pem_x509_csr(csr.encode())
                ca_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
                subject = x509.Name([
                    x509.NameAttribute(NameOID.COMMON_NAME, agent_id),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Agentic Router"),
                ])
                cert_obj = x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(csr_obj.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.utcnow()).not_valid_after(datetime.utcnow() + timedelta(days=365)).add_extension(x509.SubjectAlternativeName([x509.DNSName(agent_id)]), critical=False).sign(ca_private_key, hashes.SHA256())
                cert = cert_obj.public_bytes(serialization.Encoding.PEM).decode()
            except Exception as e:
                return jsonify({"error": f"certificate generation failed: {str(e)}"}), 500
            # Update agent state
            a.state = "REGISTERED"
            a.active = True
            a.csr = csr
            a.certificate = cert
            a.otp = None
            a.otp_expires_at = None
            a.last_heartbeat = now_utc()
            s.commit()
            return jsonify({
                "ok": True,
                "certificate": cert,
                "agent_id": agent_id,
                "state": "REGISTERED"
            })
        except Exception as e:
            return jsonify({"error": f"certificate generation failed: {str(e)}"}), 500
## --- End new agent registration logic --- ##
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

@app.route('/status')
def router_status():
    """Router status and API information"""
    try:
        # Get agent statistics
        with Session() as s:
            total_agents = s.query(Agent).count()
            active_agents = s.query(Agent).filter(Agent.active == True).count()
            
            # Get job statistics
            total_jobs = s.query(Job).count()
            running_jobs = s.query(Job).filter(Job.status == 'RUNNING').count()
            completed_jobs = s.query(Job).filter(Job.status.in_(['SUCCEEDED', 'FAILED'])).count()
        
        db_status = "connected"
    except Exception:
        total_agents = active_agents = 0
        total_jobs = running_jobs = completed_jobs = 0
        db_status = "error"
    
    return jsonify({
        "service": "Agent Router API",
        "version": "1.0",
        "status": "running",
        "database": db_status,
        "endpoints": {
            "health": "/health",
            "agents": "/agents",
            "jobs": "/jobs", 
            "submit": "/submit",
            "status_job": "/status/<job_id>",
            "logs": "/logs/<job_id>",
            "swagger": "/swagger/",
            "router_status": "/status"
        },
        "agents": {
            "total": total_agents,
            "active": active_agents,
            "inactive": total_agents - active_agents
        },
        "jobs": {
            "total": total_jobs,
            "running": running_jobs,
            "completed": completed_jobs
        }
    })

# Root endpoint is now handled by Flask route above


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
            try:
                a = Agent(agent_id=agent_id, url=url, active=False)
                s.add(a)
                s.flush()  # Flush to detect conflicts before final commit
            except Exception:
                # Handle race condition: agent was created by another process
                s.rollback()
                a = s.get(Agent, agent_id)
                if not a:
                    # Still not found, re-raise the original error
                    raise
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
            try:
                a = Agent(agent_id=agent_id, url=data.get("url") or "", active=False)
                s.add(a)
                s.flush()  # Flush to detect conflicts before final commit
            except Exception:
                # Handle race condition: agent was created by another process
                s.rollback()
                a = s.get(Agent, agent_id)
                if not a:
                    # Still not found, re-raise the original error
                    raise
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
        "name": getattr(a, "name", None),
        "url": a.url,
        "labels": labels,
        "active": bool(getattr(a, "active", False)),
        "state": getattr(a, "state", "NEW"),
        "last_heartbeat": a.last_heartbeat.isoformat() if a.last_heartbeat else None,
        "has_certificate": bool(getattr(a, "certificate", None)),
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
        if not auth_ok_with_permission(request, 'agents', 'read'):
            log_audit_event('unauthorized_access', resource='agents', details={'action': 'read', 'endpoint': '/agents'}, success=False)
            api.abort(401, "Unauthorized - requires agents:read permission")
        
        log_audit_event('list_agents', resource='agents')
        
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
            try:
                a = Agent(agent_id=agent_id, url=url)
                s.add(a)
                s.flush()  # Flush to detect conflicts before final commit
            except Exception:
                # Handle race condition: agent was created by another process
                s.rollback()
                a = s.get(Agent, agent_id)
                if not a:
                    # Still not found, re-raise the original error
                    raise
        a.url = url
        a.labels = json.dumps(labels)
        a.active = True
        a.last_heartbeat = now_utc()
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
    
    # Check authorization with permission
    if not auth_ok_with_permission(request, 'jobs', 'write'):
        log_audit_event('unauthorized_access', resource='jobs', details={'action': 'write', 'endpoint': '/submit'}, success=False)
        return {"error":"unauthorized - requires jobs:write permission"}, 401

    data = request.get_json(force=True) or {}
    # Debug: Log the received payload structure
    print(f"[ROUTER DEBUG] Received payload: {json.dumps(data, indent=2)}", file=sys.stderr)
    job_spec = (data.get("job") or {})
    route    = (data.get("route") or {})
    labels   = (route.get("labels") or {})
    target_agent_id = (route.get("agent_id") or "").strip()
    
    # Determine job source and set appropriate job-type label
    dag_id = job_spec.get("dag_id")
    task_id = job_spec.get("task_id")
    
    # If dag_id and task_id are present, it's from Airflow
    if dag_id and task_id:
        labels = dict(labels)  # Make a copy to avoid modifying original
        labels["job-type"] = "airflow"
        print(f"[ROUTER DEBUG] Job from Airflow detected, setting job-type=airflow", file=sys.stderr)
    elif not dag_id and not task_id:
        # Job from Router UI "Test A Job" - this label is already set by the frontend
        # but we can ensure it's set here too
        labels = dict(labels)  # Make a copy to avoid modifying original
        if "job-type" not in labels:
            labels["job-type"] = "test"
        print(f"[ROUTER DEBUG] Job from Router UI detected, setting job-type=test", file=sys.stderr)

    # Create job row
    jid = str(uuid.uuid4())
    dag_id = job_spec.get("dag_id")
    task_id = job_spec.get("task_id")
    # Debug: Log what we extracted
    print(f"[ROUTER DEBUG] Extracted from job_spec: dag_id='{dag_id}', task_id='{task_id}'", file=sys.stderr)
    # For jobs from Router UI "Test A Job", set to "Not Applicable" instead of "-"
    if not dag_id or dag_id == "":
        dag_id = "Not Applicable"
    if not task_id or task_id == "":
        task_id = "Not Applicable"
    print(f"[ROUTER DEBUG] Final values: dag_id='{dag_id}', task_id='{task_id}'", file=sys.stderr)
    with Session() as s:
        j = Job(
            job_id=jid,
            status="QUEUED",
            labels=json.dumps(labels),  # This now includes the job-type label
            payload=json.dumps(job_spec),
            priority=int(job_spec.get("priority", 5)),
            dag_id=dag_id,
            task_id=task_id,
            created_at=now_utc(),
            updated_at=now_utc(),
        )
        s.add(j); s.commit()
        print(f"[ROUTER DEBUG] Job {jid} created with labels: {labels}", file=sys.stderr)
        
        # Log job creation
        log_audit_event('create_job', resource='job', resource_id=jid, 
                       details={'dag_id': dag_id, 'task_id': task_id, 'labels': labels, 'priority': job_spec.get("priority", 5)})

        # dag_id and task_id are already correctly set from job_spec above
        # No need for additional payload parsing since the values are directly available
    
    # Choose agent
    with Session() as s:
        if target_agent_id:
            agent = s.get(Agent, target_agent_id)
            if not agent or not agent.active:
                j = s.get(Job, jid)
                j.status = "FAILED"; j.rc = 127
                j.note = "agent not found or inactive"
                j.updated_at = now_utc(); s.commit()
                print(f"[ROUTER DEBUG] Job {jid} failed: specific agent {target_agent_id} not found or inactive", file=sys.stderr)
                return {"job_id": jid, "status":"FAILED", "note":"agent not found or inactive"}, 400
        else:
            # For jobs without specific agent routing, try to find any active agent
            agent = pick_agent_by_labels(s, labels)
            if not agent:
                # If no agent matches labels, try to pick any active agent as fallback
                fallback_agents = s.query(Agent).filter(Agent.active == True).all()
                if fallback_agents:
                    agent = fallback_agents[0]  # Pick the first active agent
                    print(f"[ROUTER DEBUG] Job {jid} using fallback agent: {agent.agent_id}", file=sys.stderr)
                else:
                    j = s.get(Job, jid)
                    j.status = "FAILED"; j.rc = 127
                    j.note = "no suitable agent available"
                    j.updated_at = now_utc(); s.commit()
                    print(f"[ROUTER DEBUG] Job {jid} failed: no active agents available", file=sys.stderr)
                    return {"job_id": jid, "status":"FAILED", "note":"no suitable agent available"}, 200

    # Dispatch
    print(f"[ROUTER DEBUG] Dispatching job {jid} to agent {agent.agent_id} at {agent.url}", file=sys.stderr)
    try:
        r = requests.post(
            f"{agent.url.rstrip('/')}/run",
            headers={"X-Agent-Token": AGENT_TOKEN},
            json={"job_id": jid, "payload": job_spec},
            timeout=15
        )
        print(f"[ROUTER DEBUG] Agent response for job {jid}: HTTP {r.status_code}", file=sys.stderr)
        if r.status_code == 200:
            out = r.json()
            print(f"[ROUTER DEBUG] Agent accepted job {jid}: {out}", file=sys.stderr)
            with Session() as s:
                j = s.get(Job, jid)
                j.status   = "RUNNING"
                j.agent_id = agent.agent_id
                j.log_path = out.get("log_path")
                j.started_at = now_utc()  # Capture start time when job is dispatched successfully
                j.updated_at = now_utc()
                s.commit()
        else:
            print(f"[ROUTER DEBUG] Agent rejected job {jid}: {r.text[:200]}", file=sys.stderr)
            with Session() as s:
                j = s.get(Job, jid)
                j.status = "FAILED"
                j.rc = 255
                j.note = f"dispatch failed: http {r.status_code} {r.text[:200]}"
                j.agent_id = agent.agent_id
                j.updated_at = now_utc()
                s.commit()
    except Exception as e:
        print(f"[ROUTER DEBUG] Dispatch exception for job {jid}: {e}", file=sys.stderr)
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
    'note': fields.String(description='Additional information'),
    'dag_id': fields.String(description='DAG identifier (from Airflow) or "Not Applicable"'),
    'task_id': fields.String(description='Task identifier (from Airflow) or "Not Applicable"'),
    'started_at': fields.DateTime(description='Job execution start timestamp'),
    'finished_at': fields.DateTime(description='Job execution completion timestamp'),
    'execution_time': fields.String(description='Human-readable execution duration')
}))
def status(job_id: str):
    """Get job status and details"""
    import sys
    if not auth_ok_with_permission(request, 'jobs', 'read'):
        log_audit_event('unauthorized_access', resource='jobs', details={'action': 'read', 'job_id': job_id}, success=False)
        return {"error":"unauthorized - requires jobs:read permission"}, 401

    with Session() as s:
        j = s.get(Job, job_id)
        if not j:
            return {"error":"not found"}, 404
        agent = s.get(Agent, j.agent_id) if j.agent_id else None

    # Handle jobs waiting for agent sync - try to reconnect if agent is back
    if j.status == "PENDING_AGENT_SYNC" and agent and agent.active:
        print(f"[ROUTER DEBUG] Retrying agent connection for job {job_id} in PENDING_AGENT_SYNC", file=sys.stderr)
        # Agent is back online, try to get status again
        # Continue with normal flow below
    
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
                "agent_id": j.agent_id, "log_path": j.log_path, "note": j.note,
                "dag_id": j.dag_id,
                "task_id": j.task_id,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "execution_time": format_execution_time(j.started_at, j.finished_at, j.status),
            }

    try:
        agent_resp = requests.get(f"{agent.url.rstrip('/')}/status/{job_id}",
                                  headers={"X-Agent-Token": AGENT_TOKEN}, timeout=10)
    except Exception as e:
        with Session() as s:
            j = s.get(Job, job_id)
            # Don't mark as FAILED immediately - wait for agent to come back up
            # Only mark as failed if job has been waiting too long (e.g., > 1 hour)
            if j.status == "RUNNING" and j.started_at:
                time_since_start = now_utc() - j.started_at
                timeout_hours = 1  # Wait 1 hour before marking as failed
                if time_since_start.total_seconds() > timeout_hours * 3600:
                    j.status = "FAILED"; j.rc = 255
                    j.note = f"agent timeout after {timeout_hours}h: {e}"
                    j.finished_at = now_utc()
                    j.updated_at = now_utc()
                    s.commit()
                    print(f"[ROUTER DEBUG] Job {job_id} marked as FAILED after timeout", file=sys.stderr)
                else:
                    j.status = "PENDING_AGENT_SYNC"
                    j.note = f"waiting for agent reconnection: {e}"
                    j.updated_at = now_utc()
                    s.commit()
                    print(f"[ROUTER DEBUG] Job {job_id} waiting for agent sync", file=sys.stderr)
            else:
                # For non-running jobs, mark as failed immediately
                j.status = "FAILED"; j.rc = 255
                j.note = f"agent status probe failed: {e}"
                j.updated_at = now_utc()
                s.commit()
                
        with Session() as s:
            j = s.get(Job, job_id)
            print(f"[ROUTER DEBUG] Agent probe failed for job {job_id}, status={j.status} rc={j.rc}", file=sys.stderr)
            return {
                "job_id": j.job_id, "status": j.status, "rc": j.rc,
                "agent_id": j.agent_id, "log_path": j.log_path, "note": j.note,
                "dag_id": j.dag_id,
                "task_id": j.task_id,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "execution_time": format_execution_time(j.started_at, j.finished_at, j.status),
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
                
                # Use agent-provided timestamps if available
                print(f"[ROUTER DEBUG] Processing timestamps for job {job_id}: agent started_at={st.get('started_at')}, finished_at={st.get('finished_at')}, current j.started_at={j.started_at}, j.finished_at={j.finished_at}", file=sys.stderr)
                
                if st.get("started_at"):
                    agent_start_time = parse_agent_timestamp(st.get("started_at"))
                    print(f"[ROUTER DEBUG] Parsed agent start time: {agent_start_time}", file=sys.stderr)
                    if agent_start_time and not j.started_at:
                        j.started_at = agent_start_time
                        print(f"[ROUTER DEBUG] Set started_at from agent: {j.started_at}", file=sys.stderr)
                
                if st.get("finished_at"):
                    agent_finish_time = parse_agent_timestamp(st.get("finished_at"))
                    print(f"[ROUTER DEBUG] Parsed agent finish time: {agent_finish_time}", file=sys.stderr)
                    if agent_finish_time and not j.finished_at:
                        j.finished_at = agent_finish_time
                        print(f"[ROUTER DEBUG] Set finished_at from agent: {j.finished_at}", file=sys.stderr)
                    elif j.status != st["status"] and not j.finished_at:  # Fallback to router time if no agent timestamp
                        j.finished_at = now_utc()
                        print(f"[ROUTER DEBUG] Set finished_at to router time: {j.finished_at}", file=sys.stderr)
                
                j.updated_at = now_utc(); s.commit()
            elif st.get("status") == "RUNNING":
                # Store previous status before updating
                prev_status = j.status
                j.status = "RUNNING"
                if not j.agent_id:
                    j.agent_id = agent.agent_id
                
                # Use agent-provided start timestamp if available
                if not j.started_at and st.get("started_at"):
                    agent_start_time = parse_agent_timestamp(st.get("started_at"))
                    if agent_start_time:
                        j.started_at = agent_start_time
                        print(f"[ROUTER DEBUG] Set started_at from agent: {j.started_at}", file=sys.stderr)
                    elif prev_status != "RUNNING":  # Fallback to router time if no agent timestamp
                        j.started_at = now_utc()
                elif prev_status != "RUNNING" and not j.started_at:  # Fallback to router time
                    j.started_at = now_utc()
                
                j.updated_at = now_utc(); s.commit()
        elif agent_resp.status_code == 404:
            print(f"[ROUTER DEBUG] Agent 404 for job {job_id}", file=sys.stderr)
            # Agent may have restarted and lost job info, but job might still be running
            # Don't immediately fail, wait for agent to sync back
            if j.status == "RUNNING" and j.started_at:
                time_since_start = now_utc() - j.started_at
                timeout_hours = 1  # Wait 1 hour before marking as failed
                if time_since_start.total_seconds() > timeout_hours * 3600:
                    j.status = "FAILED"; j.rc = 127
                    j.note = f"agent lost job after {timeout_hours}h (404)"
                    j.finished_at = now_utc()
                else:
                    j.status = "PENDING_AGENT_SYNC"
                    j.note = "agent reports unknown job - waiting for sync"
            else:
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
        print(f"[ROUTER DEBUG] Returning status for job {job_id}: status={j.status} rc={j.rc} dag_id={j.dag_id} task_id={j.task_id}", file=sys.stderr)
        return {
            "job_id": j.job_id,
            "status": j.status,
            "rc": j.rc,
            "agent_id": j.agent_id,
            "log_path": j.log_path,
            "note": j.note,
            "dag_id": j.dag_id,
            "task_id": j.task_id,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            "execution_time": format_execution_time(j.started_at, j.finished_at, j.status),
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
    if not auth_ok_with_permission(request, 'jobs', 'read'):
        log_audit_event('unauthorized_access', resource='jobs', details={'action': 'read', 'endpoint': '/jobs'}, success=False)
        return {"error":"unauthorized - requires jobs:read permission"}, 401
    
    log_audit_event('list_jobs', resource='jobs')
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
                "dag_id": j.dag_id,
                "task_id": j.task_id,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "updated_at": j.updated_at.isoformat() if j.updated_at else None,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "execution_time": format_execution_time(j.started_at, j.finished_at, j.status),
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
