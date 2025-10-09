from flask import Blueprint, request, session, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import Column, String, Integer, DateTime, Boolean
from datetime import datetime, timedelta
import json
import uuid
import os
from functools import wraps

from models import Base, now_utc

# Authentication Blueprint
auth_bp = Blueprint('auth', __name__)

# User model for local authentication
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=True)
    password_hash = Column(String(128), nullable=False)
    groups = Column(String(256), nullable=True)  # comma-separated group names
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_utc)
    last_login = Column(DateTime, nullable=True)

# Group model for role-based access
class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    permissions = Column(String(512), nullable=True)  # JSON string of permissions
    created_at = Column(DateTime, default=now_utc)

# Authentication decorators
def login_required(f):
    """Decorator to require login for routes"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def require_group(group_name):
    """Decorator to require specific group membership"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Authentication required'}), 401
            
            user_groups = session.get('user_groups', [])
            if group_name not in user_groups and 'admin' not in user_groups:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_current_user():
    """Get current user from session"""
    if 'user_id' not in session:
        return None
    return {
        'id': session['user_id'],
        'username': session['username'],
        'groups': session.get('user_groups', [])
    }

# Authentication routes
@auth_bp.route('/register', methods=['POST'])
def register():
    """Register a new local user account"""
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    groups = data.get('groups', '')
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        # Check if user already exists
        existing_user = s.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()
        
        if existing_user:
            return jsonify({'error': 'Username or email already exists'}), 409
        
        # Create new user
        user = User(
            username=username,
            email=email if email else None,
            password_hash=generate_password_hash(password),
            groups=groups if groups else 'user',  # Default to 'user' group
            is_active=True
        )
        
        s.add(user)
        s.commit()
        
        return jsonify({
            'ok': True,
            'message': 'User registered successfully',
            'user_id': user.id,
            'username': user.username
        }), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    """Local user login"""
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        user = s.query(User).filter(User.username == username).first()
        
        if not user or not user.is_active:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        if not check_password_hash(user.password_hash, password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Update last login
        user.last_login = now_utc()
        s.commit()
        
        # Create session
        session.permanent = True
        session['user_id'] = user.id
        session['username'] = user.username
        session['user_groups'] = user.groups.split(',') if user.groups else []
        
        return jsonify({
            'ok': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': session['user_groups']
            }
        })

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Logout current user"""
    session.clear()
    return jsonify({'ok': True, 'message': 'Logged out successfully'})

@auth_bp.route('/me', methods=['GET'])
@login_required
def get_current_user_info():
    """Get current user information"""
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        user = s.query(User).filter(User.id == session['user_id']).first()
        if not user:
            session.clear()
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': user.groups.split(',') if user.groups else [],
                'last_login': user.last_login.isoformat() if user.last_login else None
            }
        })

@auth_bp.route('/users', methods=['GET'])
@require_group('admin')
def list_users():
    """List all users (admin only)"""
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        users = s.query(User).all()
        return jsonify({
            'users': [{
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': user.groups.split(',') if user.groups else [],
                'is_active': user.is_active,
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'last_login': user.last_login.isoformat() if user.last_login else None
            } for user in users]
        })

@auth_bp.route('/users/<int:user_id>/groups', methods=['PUT'])
@require_group('admin')
def update_user_groups():
    """Update user groups (admin only)"""
    data = request.get_json() or {}
    groups = data.get('groups', [])
    user_id = request.view_args['user_id']
    
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        user.groups = ','.join(groups) if groups else ''
        s.commit()
        
        return jsonify({
            'ok': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'groups': groups
            }
        })

@auth_bp.route('/groups', methods=['GET'])
@require_group('admin')
def list_groups():
    """List all groups (admin only)"""
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        groups = s.query(Group).all()
        return jsonify({
            'groups': [{
                'id': group.id,
                'name': group.name,
                'description': group.description,
                'permissions': json.loads(group.permissions) if group.permissions else [],
                'created_at': group.created_at.isoformat() if group.created_at else None
            } for group in groups]
        })

@auth_bp.route('/groups', methods=['POST'])
@require_group('admin')
def create_group():
    """Create a new group (admin only)"""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    permissions = data.get('permissions', [])
    
    if not name:
        return jsonify({'error': 'Group name required'}), 400
    
    # Import here to avoid circular imports
    from app import Session
    
    with Session() as s:
        # Check if group already exists
        existing_group = s.query(Group).filter(Group.name == name).first()
        if existing_group:
            return jsonify({'error': 'Group already exists'}), 409
        
        group = Group(
            name=name,
            description=description,
            permissions=json.dumps(permissions) if permissions else None
        )
        
        s.add(group)
        s.commit()
        
        return jsonify({
            'ok': True,
            'group': {
                'id': group.id,
                'name': group.name,
                'description': group.description,
                'permissions': permissions
            }
        }), 201

# OIDC/SAML placeholders for future enterprise authentication
@auth_bp.route('/oidc/login')
def oidc_login():
    """OIDC login endpoint (placeholder for future implementation)"""
    return jsonify({
        'error': 'OIDC authentication not configured',
        'message': 'Please configure OIDC settings to use enterprise authentication'
    }), 501

@auth_bp.route('/saml/login')
def saml_login():
    """SAML login endpoint (placeholder for future implementation)"""
    return jsonify({
        'error': 'SAML authentication not configured',
        'message': 'Please configure SAML settings to use enterprise authentication'
    }), 501

def init_auth(app):
    """Initialize authentication for the Flask app"""
    # Set secret key for sessions
    if not app.secret_key:
        app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    
    # Configure session
    app.config['SESSION_PERMANENT'] = True
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)
    
    # Tables are already created by the main app, just ensure User tables exist
    from app import engine
    Base.metadata.create_all(engine)
    
    # Create default admin user if none exists
    from app import Session
    with Session() as s:
        admin_user = s.query(User).filter(User.username == 'admin').first()
        if not admin_user:
            admin_user = User(
                username='admin',
                email='admin@localhost',
                password_hash=generate_password_hash('admin123'),
                groups='admin,user',
                is_active=True
            )
            s.add(admin_user)
            s.commit()
            print("✅ Created default admin user: admin / admin123")
    
    # Register blueprint
    app.register_blueprint(auth_bp, url_prefix='/api/auth')

def protect_route_with_auth(auth_function):
    """Wrapper to add authentication to existing routes"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Check if user is authenticated
            if 'user_id' not in session:
                return jsonify({'error': 'Authentication required'}), 401
            return f(*args, **kwargs)
        return decorated_function
    return decorator