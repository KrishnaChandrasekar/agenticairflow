#!/usr/bin/env python3
"""
Database initialization script for the enhanced security system.
This script will create the new tables and populate them with default data.
"""

import os
import sys
sys.path.append('/Users/kicha/Downloads/agenticairflow-with-dt/router')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base
from auth import User, Group, Role, Permission, AuditLog, _create_default_permissions, _create_default_roles, _create_default_groups, _create_default_users

def init_security_db():
    """Initialize the security database with tables and default data"""
    
    # Database configuration - use container path by default
    DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:////data/db.sqlite")
    
    print(f"🔧 Initializing security database at: {DATABASE_URL}")
    
    # Ensure database directory exists for SQLite DB
    _db_path = DATABASE_URL.replace("sqlite://", "")
    db_dir = os.path.dirname(_db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
        print(f"📁 Created database directory: {db_dir}")
    
    # Create engine and session
    engine = create_engine(DATABASE_URL, echo=False, future=True)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    
    # Create all tables (including new security tables)
    print("🗄️  Creating database tables...")
    Base.metadata.create_all(engine)
    print("✅ Database tables created successfully")
    
    # Initialize default security data
    print("👤 Setting up default security data...")
    with Session() as session:
        try:
            _create_default_permissions(session)
            print("✅ Default permissions created")
            
            _create_default_roles(session)
            print("✅ Default roles created")
            
            _create_default_groups(session)
            print("✅ Default groups created")
            
            _create_default_users(session)
            print("✅ Default users created")
            
            session.commit()
            
            # Print summary
            user_count = session.query(User).count()
            group_count = session.query(Group).count()
            role_count = session.query(Role).count()
            permission_count = session.query(Permission).count()
            
            print("\n🎉 Security system initialization completed!")
            print(f"📊 Summary:")
            print(f"   - Users: {user_count}")
            print(f"   - Groups: {group_count}")
            print(f"   - Roles: {role_count}")
            print(f"   - Permissions: {permission_count}")
            
            print(f"\n🔐 Default login credentials:")
            print(f"   - Admin: admin / admin123")
            print(f"   - Operator: operator / operator123")
            
            print(f"\n🚀 You can now access the Security tab in the Router UI at http://localhost:8090")
            
        except Exception as e:
            print(f"❌ Error during initialization: {e}")
            session.rollback()
            raise

if __name__ == "__main__":
    init_security_db()