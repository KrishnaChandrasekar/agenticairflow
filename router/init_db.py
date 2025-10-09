#!/usr/bin/env python3
"""
Database initialization script for Agent Router Authentication
Creates the authentication tables in the existing router database and adds default users.
"""

import os
import sys
from werkzeug.security import generate_password_hash

# Add the router directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from auth import User, Group
from app import Session, engine
from models import Base

def init_database():
    """Initialize authentication tables in the existing router database."""
    
    print("📊 Adding authentication tables to existing router database...")
    Base.metadata.create_all(engine)
    
    with Session() as s:
        # Check if admin user already exists
        admin_user = s.query(User).filter(User.username == 'admin').first()
        if not admin_user:
            print("Creating default admin user...")
            admin_user = User(
                username='admin',
                email='admin@localhost',
                password_hash=generate_password_hash('admin123'),
                groups='admin,user',
                is_active=True
            )
            s.add(admin_user)
            s.commit()
            print("✅ Default admin user created:")
            print("   Username: admin")
            print("   Password: admin123")
            print("   Groups: admin,user")
        else:
            print("✅ Admin user already exists")
        
        # Create a regular test user
        test_user = s.query(User).filter(User.username == 'testuser').first()
        if not test_user:
            test_user = User(
                username='testuser',
                email='testuser@localhost',
                password_hash=generate_password_hash('test123'),
                groups='user',
                is_active=True
            )
            s.add(test_user)
            s.commit()
            print("✅ Test user created:")
            print("   Username: testuser")
            print("   Password: test123")
            print("   Groups: user")
        else:
            print("✅ Test user already exists")
        
        # Create default groups if they don't exist
        groups_to_create = [
            ('admin', 'System administrators with full access'),
            ('user', 'Regular users with basic access'),
            ('viewer', 'Read-only access users')
        ]
        
        for group_name, description in groups_to_create:
            existing_group = s.query(Group).filter(Group.name == group_name).first()
            if not existing_group:
                group = Group(
                    name=group_name,
                    description=description,
                    permissions=f'["read", "write"]' if group_name in ['admin', 'user'] else '["read"]'
                )
                s.add(group)
                print(f"✅ Created group: {group_name}")
        
        s.commit()
            
    print("\n🎉 Authentication system initialized in router database!")
    print("📍 Using the same database as Jobs and Agents")
    print("\nYou can now:")
    print("1. Start the router: python app.py")
    print("2. Login with admin/admin123 or testuser/test123")
    print("3. Create new users via the registration form")
    print("4. All user data is stored alongside job and agent data")

if __name__ == '__main__':
    init_database()