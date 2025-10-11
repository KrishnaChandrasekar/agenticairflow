from flask import Blueprint, request, session, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import Column, String, Integer, DateTime, Boolean, Text, ForeignKey, Table
from sqlalchemy.orm import relationship
from datetime import datetime, timedelta
import json
import uuid
import os
from functools import wraps

from models import Base, now_utc

# Authentication Blueprint
auth_bp = Blueprint('auth', __name__)

# Association tables for many-to-many relationships
user_groups = Table('user_groups', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('group_id', Integer, ForeignKey('groups.id'), primary_key=True)
)

user_roles = Table('user_roles', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('role_id', Integer, ForeignKey('roles.id'), primary_key=True)
)

role_permissions = Table('role_permissions', Base.metadata,
    Column('role_id', Integer, ForeignKey('roles.id'), primary_key=True),
    Column('permission_id', Integer, ForeignKey('permissions.id'), primary_key=True)
)

group_roles = Table('group_roles', Base.metadata,
    Column('group_id', Integer, ForeignKey('groups.id'), primary_key=True),
    Column('role_id', Integer, ForeignKey('roles.id'), primary_key=True)
)

# Enhanced User model for comprehensive user management
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=True)
    first_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=True)
    phone = Column(String(20), nullable=True)
    password_hash = Column(String(128), nullable=False)
    is_active = Column(Boolean, default=True)
    is_locked = Column(Boolean, default=False)
    failed_login_attempts = Column(Integer, default=0)
    last_failed_login = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, default=now_utc)
    must_change_password = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)
    last_login = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    
    # Legacy field for backward compatibility
    groups = Column(String(256), nullable=True)
    
    # Relationships
    user_groups = relationship("Group", secondary=user_groups, back_populates="group_users")
    user_roles = relationship("Role", secondary=user_roles, back_populates="role_users")
    created_users = relationship("User", remote_side=[id])
    audit_logs = relationship("AuditLog", back_populates="user")

# Enhanced Group model for comprehensive group management
class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    display_name = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    is_system = Column(Boolean, default=False)  # System groups cannot be deleted
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    
    # Legacy field for backward compatibility
    permissions = Column(String(512), nullable=True)
    
    # Relationships
    group_users = relationship("User", secondary=user_groups, back_populates="user_groups")
    group_roles = relationship("Role", secondary=group_roles, back_populates="role_groups")

# Role model for role-based access control
class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    display_name = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    is_system = Column(Boolean, default=False)  # System roles cannot be deleted
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    
    # Relationships
    role_users = relationship("User", secondary=user_roles, back_populates="user_roles")
    role_groups = relationship("Group", secondary=group_roles, back_populates="group_roles")
    role_permissions = relationship("Permission", secondary=role_permissions, back_populates="permission_roles")

# Permission model for fine-grained access control
class Permission(Base):
    __tablename__ = "permissions"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)  # e.g., 'agents:read', 'jobs:write'
    display_name = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    resource = Column(String(50), nullable=False)  # e.g., 'agents', 'jobs', 'users', 'system'
    action = Column(String(20), nullable=False)    # e.g., 'read', 'write', 'delete', 'execute'
    is_active = Column(Boolean, default=True)
    is_system = Column(Boolean, default=False)  # System permissions cannot be deleted
    created_at = Column(DateTime, default=now_utc)
    
    # Relationships
    permission_roles = relationship("Role", secondary=role_permissions, back_populates="role_permissions")

# Audit log model for security monitoring
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    username = Column(String(80), nullable=True)  # Store username for deleted users
    action = Column(String(100), nullable=False)  # e.g., 'login', 'logout', 'create_user', 'delete_job'
    resource = Column(String(50), nullable=True)  # e.g., 'user', 'job', 'agent'
    resource_id = Column(String(50), nullable=True)  # ID of the affected resource
    details = Column(Text, nullable=True)  # JSON string with additional details
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent = Column(String(255), nullable=True)
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=now_utc)
    
    # Relationships
    user = relationship("User", back_populates="audit_logs")

# Utility functions for permission checking
def get_user_permissions(user_id):
    """Get all permissions for a user through roles and groups"""
    from app import Session
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return set()
        
        permissions = set()
        
        # Get permissions from direct user roles
        for role in user.user_roles:
            if role.is_active:
                for perm in role.role_permissions:
                    if perm.is_active:
                        permissions.add(f"{perm.resource}:{perm.action}")
        
        # Get permissions from group roles
        for group in user.user_groups:
            if group.is_active:
                for role in group.group_roles:
                    if role.is_active:
                        for perm in role.role_permissions:
                            if perm.is_active:
                                permissions.add(f"{perm.resource}:{perm.action}")
        
        return permissions

def user_has_permission(user_id, resource, action):
    """Check if user has specific permission"""
    permissions = get_user_permissions(user_id)
    return f"{resource}:{action}" in permissions or "system:admin" in permissions

def log_audit_event(action, resource=None, resource_id=None, details=None, success=True, error_message=None):
    """Log an audit event"""
    from app import Session
    from flask import request
    
    user_id = session.get('user_id')
    username = session.get('username')
    
    with Session() as s:
        audit_log = AuditLog(
            user_id=user_id,
            username=username,
            action=action,
            resource=resource,
            resource_id=str(resource_id) if resource_id else None,
            details=json.dumps(details) if details else None,
            ip_address=request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR')),
            user_agent=request.environ.get('HTTP_USER_AGENT', ''),
            success=success,
            error_message=error_message
        )
        s.add(audit_log)
        s.commit()

# Authentication decorators
def login_required(f):
    """Decorator to require login for routes"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            log_audit_event('unauthorized_access', details={'endpoint': request.endpoint}, success=False)
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def require_permission(resource, action):
    """Decorator to require specific permission"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                log_audit_event('unauthorized_access', details={'endpoint': request.endpoint, 'required_permission': f'{resource}:{action}'}, success=False)
                return jsonify({'error': 'Authentication required'}), 401
            
            user_id = session['user_id']
            if not user_has_permission(user_id, resource, action):
                log_audit_event('access_denied', resource=resource, details={'action': action, 'endpoint': request.endpoint}, success=False)
                return jsonify({'error': f'Permission denied. Required: {resource}:{action}'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_group(group_name):
    """Decorator to require specific group membership (legacy support)"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Authentication required'}), 401
            
            user_groups = session.get('user_groups', [])
            if group_name not in user_groups and 'admin' not in user_groups:
                # Also check new RBAC system
                user_id = session['user_id']
                if not user_has_permission(user_id, 'system', 'admin'):
                    log_audit_event('access_denied', details={'required_group': group_name, 'endpoint': request.endpoint}, success=False)
                    return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_any_permission(*permissions):
    """Decorator to require any of the specified permissions"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Authentication required'}), 401
            
            user_id = session['user_id']
            user_permissions = get_user_permissions(user_id)
            
            # Check if user has any of the required permissions
            has_permission = False
            for perm in permissions:
                if ':' in perm:
                    resource, action = perm.split(':', 1)
                    if f"{resource}:{action}" in user_permissions:
                        has_permission = True
                        break
            
            # System admin has all permissions
            if "system:admin" in user_permissions:
                has_permission = True
            
            if not has_permission:
                log_audit_event('access_denied', details={'required_permissions': list(permissions), 'endpoint': request.endpoint}, success=False)
                return jsonify({'error': f'Permission denied. Required: {" OR ".join(permissions)}'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_current_user():
    """Get current user from session with permissions"""
    if 'user_id' not in session:
        return None
    
    user_id = session['user_id']
    permissions = get_user_permissions(user_id)
    
    return {
        'id': user_id,
        'username': session['username'],
        'groups': session.get('user_groups', []),
        'permissions': list(permissions)
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
        
        # Get user permissions through roles (same as /me endpoint)
        permissions = set()
        for role in user.user_roles:
            for permission in role.role_permissions:
                permissions.add(permission.name)
        
        return jsonify({
            'ok': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': session['user_groups'],
                'permissions': list(permissions),
                'last_login': user.last_login.isoformat() if user.last_login else None
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
        
        # Get user permissions through roles
        permissions = set()
        for role in user.user_roles:
            for permission in role.role_permissions:
                permissions.add(permission.name)
        
        return jsonify({
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': user.groups.split(',') if user.groups else [],
                'permissions': list(permissions),
                'last_login': user.last_login.isoformat() if user.last_login else None
            }
        })

# User Management Endpoints
@auth_bp.route('/users', methods=['GET'])
@require_permission('users', 'read')
def list_users():
    """List all users with comprehensive information"""
    from app import Session
    
    # Get query parameters
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    search = request.args.get('search', '').strip()
    is_active = request.args.get('is_active')
    
    with Session() as s:
        query = s.query(User)
        
        # Apply filters
        if search:
            query = query.filter(
                (User.username.contains(search)) |
                (User.email.contains(search)) |
                (User.first_name.contains(search)) |
                (User.last_name.contains(search))
            )
        
        if is_active is not None:
            query = query.filter(User.is_active == (is_active.lower() == 'true'))
        
        # Get total count
        total = query.count()
        
        # Apply pagination
        users = query.offset((page - 1) * per_page).limit(per_page).all()
        
        log_audit_event('list_users', resource='users', details={'page': page, 'per_page': per_page, 'total': total})
        
        return jsonify({
            'users': [{
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'phone': user.phone,
                'is_active': user.is_active,
                'is_locked': user.is_locked,
                'failed_login_attempts': user.failed_login_attempts,
                'must_change_password': user.must_change_password,
                'groups': [{'id': g.id, 'name': g.name, 'display_name': g.display_name} for g in user.user_groups],
                'roles': [{'id': r.id, 'name': r.name, 'display_name': r.display_name} for r in user.user_roles],
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'updated_at': user.updated_at.isoformat() if user.updated_at else None,
                'last_login': user.last_login.isoformat() if user.last_login else None,
                'password_changed_at': user.password_changed_at.isoformat() if user.password_changed_at else None
            } for user in users],
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': total,
                'pages': (total + per_page - 1) // per_page
            }
        })

@auth_bp.route('/users/<int:user_id>', methods=['GET'])
@require_permission('users', 'read')
def get_user(user_id):
    """Get detailed information about a specific user"""
    from app import Session
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        user_permissions = get_user_permissions(user_id)
        
        return jsonify({
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'phone': user.phone,
                'is_active': user.is_active,
                'is_locked': user.is_locked,
                'failed_login_attempts': user.failed_login_attempts,
                'must_change_password': user.must_change_password,
                'groups': [{'id': g.id, 'name': g.name, 'display_name': g.display_name, 'description': g.description} for g in user.user_groups],
                'roles': [{'id': r.id, 'name': r.name, 'display_name': r.display_name, 'description': r.description} for r in user.user_roles],
                'permissions': list(user_permissions),
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'updated_at': user.updated_at.isoformat() if user.updated_at else None,
                'last_login': user.last_login.isoformat() if user.last_login else None,
                'password_changed_at': user.password_changed_at.isoformat() if user.password_changed_at else None
            }
        })

@auth_bp.route('/users', methods=['POST'])
@require_permission('users', 'write')
def create_user():
    """Create a new user"""
    from app import Session
    
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    first_name = data.get('first_name', '').strip()
    last_name = data.get('last_name', '').strip()
    phone = data.get('phone', '').strip()
    group_ids = data.get('group_ids', [])
    role_ids = data.get('role_ids', [])
    must_change_password = data.get('must_change_password', False)
    
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
    with Session() as s:
        # Check if user already exists
        existing_user = s.query(User).filter(
            (User.username == username) | 
            (User.email == email if email else '')
        ).first()
        
        if existing_user:
            return jsonify({'error': 'Username or email already exists'}), 409
        
        # Create new user
        user = User(
            username=username,
            email=email if email else None,
            first_name=first_name if first_name else None,
            last_name=last_name if last_name else None,
            phone=phone if phone else None,
            password_hash=generate_password_hash(password),
            must_change_password=must_change_password,
            created_by=session['user_id']
        )
        
        s.add(user)
        s.flush()  # Get the user ID
        
        # Add groups
        if group_ids:
            groups = s.query(Group).filter(Group.id.in_(group_ids)).all()
            user.user_groups.extend(groups)
        
        # Add roles
        if role_ids:
            roles = s.query(Role).filter(Role.id.in_(role_ids)).all()
            user.user_roles.extend(roles)
        
        s.commit()
        
        log_audit_event('create_user', resource='user', resource_id=user.id, 
                       details={'username': username, 'email': email, 'groups': group_ids, 'roles': role_ids})
        
        return jsonify({
            'ok': True,
            'message': 'User created successfully',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name
            }
        }), 201

@auth_bp.route('/users/<int:user_id>', methods=['PUT'])
@require_permission('users', 'write')
def update_user(user_id):
    """Update user information"""
    from app import Session
    
    data = request.get_json() or {}
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Update basic fields
        if 'email' in data:
            email = data['email'].strip()
            if email and email != user.email:
                # Check if email is already taken
                existing = s.query(User).filter(User.email == email, User.id != user_id).first()
                if existing:
                    return jsonify({'error': 'Email already exists'}), 409
                user.email = email
        
        if 'first_name' in data:
            user.first_name = data['first_name'].strip() or None
        if 'last_name' in data:
            user.last_name = data['last_name'].strip() or None
        if 'phone' in data:
            user.phone = data['phone'].strip() or None
        if 'is_active' in data:
            user.is_active = data['is_active']
        if 'is_locked' in data:
            user.is_locked = data['is_locked']
            if not data['is_locked']:  # Unlock user
                user.failed_login_attempts = 0
        if 'must_change_password' in data:
            user.must_change_password = data['must_change_password']
        
        # Update groups
        if 'group_ids' in data:
            user.user_groups.clear()
            if data['group_ids']:
                groups = s.query(Group).filter(Group.id.in_(data['group_ids'])).all()
                user.user_groups.extend(groups)
        
        # Update roles
        if 'role_ids' in data:
            user.user_roles.clear()
            if data['role_ids']:
                roles = s.query(Role).filter(Role.id.in_(data['role_ids'])).all()
                user.user_roles.extend(roles)
        
        user.updated_at = now_utc()
        s.commit()
        
        log_audit_event('update_user', resource='user', resource_id=user_id, details=data)
        
        return jsonify({
            'ok': True,
            'message': 'User updated successfully'
        })

@auth_bp.route('/users/<int:user_id>/password', methods=['PUT'])
@require_any_permission('users:write', 'users:admin')
def change_user_password(user_id):
    """Change user password (admin) or own password"""
    from app import Session
    
    current_user_id = session['user_id']
    data = request.get_json() or {}
    new_password = data.get('new_password', '')
    current_password = data.get('current_password', '')
    
    if not new_password:
        return jsonify({'error': 'New password is required'}), 400
    
    if len(new_password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # If changing own password, verify current password
        if user_id == current_user_id and not check_password_hash(user.password_hash, current_password):
            return jsonify({'error': 'Current password is incorrect'}), 400
        
        # If admin changing another user's password, check admin permission
        if user_id != current_user_id and not user_has_permission(current_user_id, 'users', 'admin'):
            return jsonify({'error': 'Permission denied'}), 403
        
        user.password_hash = generate_password_hash(new_password)
        user.password_changed_at = now_utc()
        user.must_change_password = False
        user.failed_login_attempts = 0
        user.is_locked = False
        s.commit()
        
        log_audit_event('change_password', resource='user', resource_id=user_id)
        
        return jsonify({
            'ok': True,
            'message': 'Password changed successfully'
        })

@auth_bp.route('/users/<int:user_id>', methods=['DELETE'])
@require_permission('users', 'delete')
def delete_user(user_id):
    """Delete a user (soft delete by deactivating)"""
    from app import Session
    
    current_user_id = session['user_id']
    
    if user_id == current_user_id:
        return jsonify({'error': 'Cannot delete your own account'}), 400
    
    with Session() as s:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        user.is_active = False
        user.updated_at = now_utc()
        s.commit()
        
        log_audit_event('delete_user', resource='user', resource_id=user_id, 
                       details={'username': user.username})
        
        return jsonify({
            'ok': True,
            'message': 'User deleted successfully'
        })

# Group Management Endpoints
@auth_bp.route('/groups', methods=['GET'])
@require_permission('groups', 'read')
def list_groups():
    """List all groups"""
    from app import Session
    
    with Session() as s:
        groups = s.query(Group).filter(Group.is_active == True).all()
        return jsonify({
            'groups': [{
                'id': group.id,
                'name': group.name,
                'display_name': group.display_name,
                'description': group.description,
                'is_system': group.is_system,
                'roles': [{'id': r.id, 'name': r.name, 'display_name': r.display_name} for r in group.group_roles],
                'user_count': len(group.group_users),
                'created_at': group.created_at.isoformat() if group.created_at else None
            } for group in groups]
        })

@auth_bp.route('/groups', methods=['POST'])
@require_permission('groups', 'write')
def create_group():
    """Create a new group"""
    from app import Session
    
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    display_name = data.get('display_name', '').strip()
    description = data.get('description', '').strip()
    role_ids = data.get('role_ids', [])
    
    if not name:
        return jsonify({'error': 'Group name is required'}), 400
    
    with Session() as s:
        # Check if group already exists
        existing_group = s.query(Group).filter(Group.name == name).first()
        if existing_group:
            return jsonify({'error': 'Group already exists'}), 409
        
        group = Group(
            name=name,
            display_name=display_name if display_name else name,
            description=description if description else None,
            created_by=session['user_id']
        )
        
        s.add(group)
        s.flush()
        
        # Add roles
        if role_ids:
            roles = s.query(Role).filter(Role.id.in_(role_ids)).all()
            group.group_roles.extend(roles)
        
        s.commit()
        
        log_audit_event('create_group', resource='group', resource_id=group.id, 
                       details={'name': name, 'roles': role_ids})
        
        return jsonify({
            'ok': True,
            'message': 'Group created successfully',
            'group': {
                'id': group.id,
                'name': group.name,
                'display_name': group.display_name,
                'description': group.description
            }
        }), 201

@auth_bp.route('/groups/<int:group_id>', methods=['PUT'])
@require_permission('groups', 'write')  
def update_group(group_id):
    """Update group information"""
    from app import Session
    
    data = request.get_json() or {}
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
            
        if group.is_system:
            return jsonify({'error': 'Cannot modify system group'}), 403
        
        if 'display_name' in data:
            group.display_name = data['display_name'].strip() or group.name
        if 'description' in data:
            group.description = data['description'].strip() or None
        
        # Update roles
        if 'role_ids' in data:
            group.group_roles.clear()
            if data['role_ids']:
                roles = s.query(Role).filter(Role.id.in_(data['role_ids'])).all()
                group.group_roles.extend(roles)
        
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('update_group', resource='group', resource_id=group_id, details=data)
        
        return jsonify({
            'ok': True,
            'message': 'Group updated successfully'
        })

@auth_bp.route('/groups/<int:group_id>', methods=['DELETE'])
@require_permission('groups', 'delete')
def delete_group(group_id):
    """Delete a group"""
    from app import Session
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
            
        if group.is_system:
            return jsonify({'error': 'Cannot delete system group'}), 403
        
        group.is_active = False
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('delete_group', resource='group', resource_id=group_id, 
                       details={'name': group.name})
        
        return jsonify({
            'ok': True,
            'message': 'Group deleted successfully'
        })

# Group Member Management Endpoints
@auth_bp.route('/groups/<int:group_id>/members', methods=['GET'])
@require_permission('groups', 'read')
def get_group_members(group_id):
    """Get all members of a group"""
    from app import Session
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        members = [{
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'is_active': user.is_active
        } for user in group.group_users]
        
        return jsonify({
            'members': members,
            'group_id': group_id,
            'group_name': group.name
        })

@auth_bp.route('/groups/<int:group_id>/members', methods=['POST'])
@require_permission('groups', 'write')
def add_group_member(group_id):
    """Add a member to a group"""
    from app import Session
    
    data = request.get_json() or {}
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Check if user is already a member
        if user in group.group_users:
            return jsonify({'error': 'User is already a member of this group'}), 409
        
        # Add user to group
        group.group_users.append(user)
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('add_group_member', resource='group', resource_id=group_id,
                       details={'user_id': user_id, 'username': user.username})
        
        return jsonify({
            'ok': True,
            'message': f'User {user.username} added to group {group.name}',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            }
        })

@auth_bp.route('/groups/<int:group_id>/members/<int:user_id>', methods=['DELETE'])
@require_permission('groups', 'write')
def remove_group_member(group_id, user_id):
    """Remove a member from a group"""
    from app import Session
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Check if user is a member
        if user not in group.group_users:
            return jsonify({'error': 'User is not a member of this group'}), 404
        
        # Remove user from group
        group.group_users.remove(user)
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('remove_group_member', resource='group', resource_id=group_id,
                       details={'user_id': user_id, 'username': user.username})
        
        return jsonify({
            'ok': True,
            'message': f'User {user.username} removed from group {group.name}'
        })

@auth_bp.route('/groups/<int:group_id>/members', methods=['PUT'])
@require_permission('groups', 'write')
def update_group_members(group_id):
    """Update group membership (bulk add/remove members)"""
    from app import Session
    
    data = request.get_json() or {}
    member_ids = data.get('member_ids', [])
    
    if not isinstance(member_ids, list):
        return jsonify({'error': 'member_ids must be an array'}), 400
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        # Get valid users
        users = s.query(User).filter(User.id.in_(member_ids)).all() if member_ids else []
        user_dict = {user.id: user for user in users}
        
        # Validate all user IDs exist
        invalid_ids = [uid for uid in member_ids if uid not in user_dict]
        if invalid_ids:
            return jsonify({'error': f'Users not found: {invalid_ids}'}), 404
        
        # Get current members
        current_members = set(user.id for user in group.group_users)
        new_members = set(member_ids)
        
        # Calculate changes
        to_add = new_members - current_members
        to_remove = current_members - new_members
        
        # Apply changes
        if to_remove:
            users_to_remove = [user for user in group.group_users if user.id in to_remove]
            for user in users_to_remove:
                group.group_users.remove(user)
        
        if to_add:
            users_to_add = [user_dict[uid] for uid in to_add]
            group.group_users.extend(users_to_add)
        
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('update_group_members', resource='group', resource_id=group_id,
                       details={
                           'added_users': list(to_add),
                           'removed_users': list(to_remove),
                           'total_members': len(member_ids)
                       })
        
        return jsonify({
            'ok': True,
            'message': f'Group membership updated: {len(to_add)} added, {len(to_remove)} removed',
            'changes': {
                'added': len(to_add),
                'removed': len(to_remove),
                'total_members': len(member_ids)
            }
        })

# Role Management Endpoints
@auth_bp.route('/roles', methods=['GET'])
@require_permission('roles', 'read')
def list_roles():
    """List all roles"""
    from app import Session
    
    with Session() as s:
        roles = s.query(Role).filter(Role.is_active == True).all()
        return jsonify({
            'roles': [{
                'id': role.id,
                'name': role.name,
                'display_name': role.display_name,
                'description': role.description,
                'is_system': role.is_system,
                'permissions': [{'id': p.id, 'name': p.name, 'display_name': p.display_name, 'resource': p.resource, 'action': p.action} for p in role.role_permissions],
                'user_count': len(role.role_users),
                'group_count': len(role.role_groups),
                'created_at': role.created_at.isoformat() if role.created_at else None
            } for role in roles]
        })

@auth_bp.route('/roles', methods=['POST'])
@require_permission('roles', 'write')
def create_role():
    """Create a new role"""
    from app import Session
    
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    display_name = data.get('display_name', '').strip()
    description = data.get('description', '').strip()
    permission_ids = data.get('permission_ids', [])
    
    if not name:
        return jsonify({'error': 'Role name is required'}), 400
    
    with Session() as s:
        # Check if role already exists
        existing_role = s.query(Role).filter(Role.name == name).first()
        if existing_role:
            return jsonify({'error': 'Role already exists'}), 409
        
        role = Role(
            name=name,
            display_name=display_name if display_name else name,
            description=description if description else None,
            created_by=session['user_id']
        )
        
        s.add(role)
        s.flush()
        
        # Add permissions
        if permission_ids:
            permissions = s.query(Permission).filter(Permission.id.in_(permission_ids)).all()
            role.role_permissions.extend(permissions)
        
        s.commit()
        
        log_audit_event('create_role', resource='role', resource_id=role.id, 
                       details={'name': name, 'permissions': permission_ids})
        
        return jsonify({
            'ok': True,
            'message': 'Role created successfully',
            'role': {
                'id': role.id,
                'name': role.name,
                'display_name': role.display_name,
                'description': role.description
            }
        }), 201

@auth_bp.route('/roles/<int:role_id>', methods=['PUT'])
@require_permission('roles', 'write')
def update_role(role_id):
    """Update role information"""
    from app import Session
    
    data = request.get_json() or {}
    
    with Session() as s:
        role = s.query(Role).filter(Role.id == role_id).first()
        if not role:
            return jsonify({'error': 'Role not found'}), 404
            
        if role.is_system:
            return jsonify({'error': 'Cannot modify system role'}), 403
        
        if 'display_name' in data:
            role.display_name = data['display_name'].strip() or role.name
        if 'description' in data:
            role.description = data['description'].strip() or None
        
        # Update permissions
        if 'permission_ids' in data:
            role.role_permissions.clear()
            if data['permission_ids']:
                permissions = s.query(Permission).filter(Permission.id.in_(data['permission_ids'])).all()
                role.role_permissions.extend(permissions)
        
        role.updated_at = now_utc()
        s.commit()
        
        log_audit_event('update_role', resource='role', resource_id=role_id, details=data)
        
        return jsonify({
            'ok': True,
            'message': 'Role updated successfully'
        })

@auth_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@require_permission('roles', 'delete')
def delete_role(role_id):
    """Delete a role"""
    from app import Session
    
    with Session() as s:
        role = s.query(Role).filter(Role.id == role_id).first()
        if not role:
            return jsonify({'error': 'Role not found'}), 404
            
        if role.is_system:
            return jsonify({'error': 'Cannot delete system role'}), 403
        
        role.is_active = False
        role.updated_at = now_utc()
        s.commit()
        
        log_audit_event('delete_role', resource='role', resource_id=role_id, 
                       details={'name': role.name})
        
        return jsonify({
            'ok': True,
            'message': 'Role deleted successfully'
        })

# Permission Management Endpoints
@auth_bp.route('/permissions', methods=['GET'])
@require_permission('permissions', 'read')
def list_permissions():
    """List all permissions"""
    from app import Session
    
    with Session() as s:
        permissions = s.query(Permission).filter(Permission.is_active == True).all()
        
        # Group permissions by resource
        permissions_by_resource = {}
        for perm in permissions:
            if perm.resource not in permissions_by_resource:
                permissions_by_resource[perm.resource] = []
            permissions_by_resource[perm.resource].append({
                'id': perm.id,
                'name': perm.name,
                'display_name': perm.display_name,
                'description': perm.description,
                'action': perm.action,
                'is_system': perm.is_system
            })
        
        return jsonify({
            'permissions': permissions_by_resource,
            'all_permissions': [{
                'id': perm.id,
                'name': perm.name,
                'display_name': perm.display_name,
                'description': perm.description,
                'resource': perm.resource,
                'action': perm.action,
                'is_system': perm.is_system
            } for perm in permissions]
        })

@auth_bp.route('/permissions', methods=['POST'])
@require_permission('permissions', 'write')
def create_permission():
    """Create a new permission"""
    from app import Session
    
    data = request.get_json() or {}
    resource = data.get('resource', '').strip()
    action = data.get('action', '').strip()
    display_name = data.get('display_name', '').strip()
    description = data.get('description', '').strip()
    
    if not resource or not action:
        return jsonify({'error': 'Resource and action are required'}), 400
    
    name = f"{resource}:{action}"
    
    with Session() as s:
        # Check if permission already exists
        existing_perm = s.query(Permission).filter(Permission.name == name).first()
        if existing_perm:
            return jsonify({'error': 'Permission already exists'}), 409
        
        permission = Permission(
            name=name,
            display_name=display_name if display_name else name,
            description=description if description else None,
            resource=resource,
            action=action
        )
        
        s.add(permission)
        s.commit()
        
        log_audit_event('create_permission', resource='permission', resource_id=permission.id, 
                       details={'name': name, 'resource': resource, 'action': action})
        
        return jsonify({
            'ok': True,
            'message': 'Permission created successfully',
            'permission': {
                'id': permission.id,
                'name': permission.name,
                'display_name': permission.display_name,
                'resource': permission.resource,
                'action': permission.action
            }
        }), 201

# Group Permissions Management Endpoints
@auth_bp.route('/groups/<int:group_id>/permissions', methods=['GET'])
@require_permission('groups', 'read')
def get_group_permissions(group_id):
    """Get all permissions assigned to a group"""
    from app import Session
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        permissions = []
        for role in group.group_roles:
            for permission in role.role_permissions:
                if permission.is_active:
                    permissions.append({
                        'id': permission.id,
                        'name': permission.name,
                        'display_name': permission.display_name,
                        'description': permission.description,
                        'resource': permission.resource,
                        'action': permission.action,
                        'is_system': permission.is_system
                    })
        
        # Remove duplicates (in case multiple roles have same permission)
        unique_permissions = []
        seen_ids = set()
        for perm in permissions:
            if perm['id'] not in seen_ids:
                unique_permissions.append(perm)
                seen_ids.add(perm['id'])
        
        return jsonify({
            'permissions': unique_permissions,
            'group_id': group_id,
            'group_name': group.name
        })

@auth_bp.route('/groups/<int:group_id>/permissions', methods=['POST'])
@require_permission('groups', 'write')
def add_group_permission(group_id):
    """Add a permission to a group (via role assignment)"""
    from app import Session
    
    data = request.get_json() or {}
    permission_name = data.get('permission_name')
    
    if not permission_name:
        return jsonify({'error': 'permission_name is required'}), 400
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        permission = s.query(Permission).filter(Permission.name == permission_name).first()
        if not permission:
            return jsonify({'error': 'Permission not found'}), 404
        
        # Find or create a role for this specific permission
        role_name = f"auto_{permission.resource}_{permission.action}"
        role = s.query(Role).filter(Role.name == role_name).first()
        
        if not role:
            role = Role(
                name=role_name,
                display_name=f"Auto: {permission.display_name}",
                description=f"Auto-created role for {permission.name}",
                is_system=False,
                created_by=session.get('user_id')
            )
            s.add(role)
            s.flush()
            role.role_permissions.append(permission)
        
        # Add role to group if not already assigned
        if role not in group.group_roles:
            group.group_roles.append(role)
            group.updated_at = now_utc()
            s.commit()
            
            log_audit_event('add_group_permission', resource='group', resource_id=group_id,
                           details={'permission_name': permission_name, 'role_created': role.name})
            
            return jsonify({
                'ok': True,
                'message': f'Permission {permission.display_name} added to group {group.name}',
                'permission': {
                    'id': permission.id,
                    'name': permission.name,
                    'display_name': permission.display_name
                }
            })
        else:
            return jsonify({'error': 'Permission already assigned to group'}), 409

@auth_bp.route('/groups/<int:group_id>/permissions/<int:permission_id>', methods=['DELETE'])
@require_permission('groups', 'write')
def remove_group_permission(group_id, permission_id):
    """Remove a permission from a group"""
    from app import Session
    
    with Session() as s:
        group = s.query(Group).filter(Group.id == group_id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        
        permission = s.query(Permission).filter(Permission.id == permission_id).first()
        if not permission:
            return jsonify({'error': 'Permission not found'}), 404
        
        # Find roles in the group that have this permission
        roles_to_remove = []
        for role in group.group_roles:
            if permission in role.role_permissions:
                # If it's an auto-created role with only this permission, remove the role
                if role.name.startswith('auto_') and len(role.role_permissions) == 1:
                    roles_to_remove.append(role)
                # Otherwise, just remove the permission from the role
                else:
                    role.role_permissions.remove(permission)
        
        # Remove auto-created roles
        for role in roles_to_remove:
            group.group_roles.remove(role)
            s.delete(role)  # Delete the auto-created role entirely
        
        group.updated_at = now_utc()
        s.commit()
        
        log_audit_event('remove_group_permission', resource='group', resource_id=group_id,
                       details={'permission_id': permission_id, 'permission_name': permission.name})
        
        return jsonify({
            'ok': True,
            'message': f'Permission {permission.display_name} removed from group {group.name}'
        })

# Audit Log Endpoints
@auth_bp.route('/audit-logs', methods=['GET'])
@require_permission('audit', 'read')
def list_audit_logs():
    """List audit logs with filtering"""
    from app import Session
    
    # Get query parameters
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    user_id = request.args.get('user_id', type=int)
    action = request.args.get('action', '').strip()
    resource = request.args.get('resource', '').strip()
    success = request.args.get('success')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    with Session() as s:
        query = s.query(AuditLog).order_by(AuditLog.timestamp.desc())
        
        # Apply filters
        if user_id:
            query = query.filter(AuditLog.user_id == user_id)
        if action:
            query = query.filter(AuditLog.action.contains(action))
        if resource:
            query = query.filter(AuditLog.resource == resource)
        if success is not None:
            query = query.filter(AuditLog.success == (success.lower() == 'true'))
        if start_date:
            query = query.filter(AuditLog.timestamp >= datetime.fromisoformat(start_date))
        if end_date:
            query = query.filter(AuditLog.timestamp <= datetime.fromisoformat(end_date))
        
        # Get total count
        total = query.count()
        
        # Apply pagination
        logs = query.offset((page - 1) * per_page).limit(per_page).all()
        
        return jsonify({
            'audit_logs': [{
                'id': log.id,
                'user_id': log.user_id,
                'username': log.username,
                'action': log.action,
                'resource': log.resource,
                'resource_id': log.resource_id,
                'details': json.loads(log.details) if log.details else None,
                'ip_address': log.ip_address,
                'user_agent': log.user_agent,
                'success': log.success,
                'error_message': log.error_message,
                'timestamp': log.timestamp.isoformat() if log.timestamp else None
            } for log in logs],
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': total,
                'pages': (total + per_page - 1) // per_page
            }
        })

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
    
    # Initialize default permissions, roles, groups, and users
    from app import Session
    with Session() as s:
        _create_default_permissions(s)
        _create_default_roles(s)
        _create_default_groups(s)
        _create_default_users(s)
        s.commit()
    
    # Register blueprint
    app.register_blueprint(auth_bp, url_prefix='/api/auth')

def _create_default_permissions(session):
    """Create default system permissions"""
    default_permissions = [
        # System permissions
        ('system', 'admin', 'System Administrator', 'Full system access'),
        ('system', 'read', 'System Read', 'Read system information'),
        
        # User management
        ('users', 'read', 'Read Users', 'View user information'),
        ('users', 'write', 'Manage Users', 'Create and modify users'),
        ('users', 'delete', 'Delete Users', 'Delete user accounts'),
        ('users', 'admin', 'User Admin', 'Full user management including password changes'),
        
        # Group management
        ('groups', 'read', 'Read Groups', 'View group information'),
        ('groups', 'write', 'Manage Groups', 'Create and modify groups'),
        ('groups', 'delete', 'Delete Groups', 'Delete groups'),
        
        # Role management
        ('roles', 'read', 'Read Roles', 'View role information'),
        ('roles', 'write', 'Manage Roles', 'Create and modify roles'),
        ('roles', 'delete', 'Delete Roles', 'Delete roles'),
        
        # Permission management
        ('permissions', 'read', 'Read Permissions', 'View permission information'),
        ('permissions', 'write', 'Manage Permissions', 'Create and modify permissions'),
        
        # Agent management
        ('agents', 'read', 'Read Agents', 'View agent information'),
        ('agents', 'write', 'Manage Agents', 'Create and modify agents'),
        ('agents', 'delete', 'Delete Agents', 'Delete agents'),
        ('agents', 'execute', 'Execute Agents', 'Run agent tasks'),
        
        # Job management
        ('jobs', 'read', 'Read Jobs', 'View job information'),
        ('jobs', 'write', 'Manage Jobs', 'Create and modify jobs'),
        ('jobs', 'delete', 'Delete Jobs', 'Delete jobs'),
        ('jobs', 'execute', 'Execute Jobs', 'Run jobs'),
        
        # Audit logs
        ('audit', 'read', 'Read Audit Logs', 'View audit and security logs'),
        
        # Analytics
        ('analytics', 'read', 'View Analytics', 'View system analytics and reports'),
    ]
    
    for resource, action, display_name, description in default_permissions:
        name = f"{resource}:{action}"
        existing = session.query(Permission).filter(Permission.name == name).first()
        if not existing:
            permission = Permission(
                name=name,
                display_name=display_name,
                description=description,
                resource=resource,
                action=action,
                is_system=True
            )
            session.add(permission)

def _create_default_roles(session):
    """Create default system roles"""
    # Super Admin Role
    admin_role = session.query(Role).filter(Role.name == 'super_admin').first()
    if not admin_role:
        admin_role = Role(
            name='super_admin',
            display_name='Super Administrator',
            description='Full system access with all permissions',
            is_system=True
        )
        session.add(admin_role)
        session.flush()
        
        # Give admin all permissions
        all_perms = session.query(Permission).all()
        admin_role.role_permissions.extend(all_perms)
    
    # User Manager Role
    user_mgr_role = session.query(Role).filter(Role.name == 'user_manager').first()
    if not user_mgr_role:
        user_mgr_role = Role(
            name='user_manager',
            display_name='User Manager',
            description='Manage users, groups, and basic system operations',
            is_system=True
        )
        session.add(user_mgr_role)
        session.flush()
        
        # Give user management permissions
        user_perms = session.query(Permission).filter(
            Permission.resource.in_(['users', 'groups', 'audit'])
        ).all()
        user_mgr_role.role_permissions.extend(user_perms)
    
    # Agent Operator Role
    agent_op_role = session.query(Role).filter(Role.name == 'agent_operator').first()
    if not agent_op_role:
        agent_op_role = Role(
            name='agent_operator',
            display_name='Agent Operator',
            description='Manage and execute agents and jobs',
            is_system=True
        )
        session.add(agent_op_role)
        session.flush()
        
        # Give agent and job permissions
        op_perms = session.query(Permission).filter(
            Permission.resource.in_(['agents', 'jobs', 'analytics'])
        ).all()
        agent_op_role.role_permissions.extend(op_perms)
    
    # Viewer Role
    viewer_role = session.query(Role).filter(Role.name == 'viewer').first()
    if not viewer_role:
        viewer_role = Role(
            name='viewer',
            display_name='Viewer',
            description='Read-only access to system information',
            is_system=True
        )
        session.add(viewer_role)
        session.flush()
        
        # Give read-only permissions
        read_perms = session.query(Permission).filter(
            Permission.action == 'read'
        ).all()
        viewer_role.role_permissions.extend(read_perms)

def _create_default_groups(session):
    """Create default system groups"""
    # Administrators Group
    admin_group = session.query(Group).filter(Group.name == 'administrators').first()
    if not admin_group:
        admin_group = Group(
            name='administrators',
            display_name='Administrators',
            description='System administrators with full access',
            is_system=True
        )
        session.add(admin_group)
        session.flush()
        
        # Assign super admin role
        super_admin_role = session.query(Role).filter(Role.name == 'super_admin').first()
        if super_admin_role:
            admin_group.group_roles.append(super_admin_role)
    
    # Users Group
    users_group = session.query(Group).filter(Group.name == 'users').first()
    if not users_group:
        users_group = Group(
            name='users',
            display_name='Users',
            description='Standard users with basic access',
            is_system=True
        )
        session.add(users_group)
        session.flush()
        
        # Assign viewer role
        viewer_role = session.query(Role).filter(Role.name == 'viewer').first()
        if viewer_role:
            users_group.group_roles.append(viewer_role)
    
    # Operators Group
    operators_group = session.query(Group).filter(Group.name == 'operators').first()
    if not operators_group:
        operators_group = Group(
            name='operators',
            display_name='Operators',
            description='Agent and job operators',
            is_system=True
        )
        session.add(operators_group)
        session.flush()
        
        # Assign agent operator role
        agent_op_role = session.query(Role).filter(Role.name == 'agent_operator').first()
        if agent_op_role:
            operators_group.group_roles.append(agent_op_role)

def _create_default_users(session):
    """Create default admin user"""
    admin_user = session.query(User).filter(User.username == 'admin').first()
    if not admin_user:
        admin_user = User(
            username='admin',
            email='admin@localhost',
            first_name='System',
            last_name='Administrator',
            password_hash=generate_password_hash('admin123'),
            groups='admin,user',  # Legacy field for backward compatibility
            is_active=True
        )
        session.add(admin_user)
        session.flush()
        
        # Add to administrators group
        admin_group = session.query(Group).filter(Group.name == 'administrators').first()
        if admin_group:
            admin_user.user_groups.append(admin_group)
        
        # Add super admin role directly
        super_admin_role = session.query(Role).filter(Role.name == 'super_admin').first()
        if super_admin_role:
            admin_user.user_roles.append(super_admin_role)
        
        print("✅ Created default admin user: admin / admin123")
    
    # Create a demo operator user
    operator_user = session.query(User).filter(User.username == 'operator').first()
    if not operator_user:
        operator_user = User(
            username='operator',
            email='operator@localhost',
            first_name='Demo',
            last_name='Operator',
            password_hash=generate_password_hash('operator123'),
            groups='operators,user',  # Legacy field
            is_active=True
        )
        session.add(operator_user)
        session.flush()
        
        # Add to operators group
        operators_group = session.query(Group).filter(Group.name == 'operators').first()
        if operators_group:
            operator_user.user_groups.append(operators_group)
        
        print("✅ Created demo operator user: operator / operator123")

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