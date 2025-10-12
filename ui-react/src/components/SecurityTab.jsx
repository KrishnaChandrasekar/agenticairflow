import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserGear, faUsers, faFileLines, faShieldHalved, faKey, faUser } from '@fortawesome/free-solid-svg-icons';
import UserManagement from './security/UserManagement';
import GroupManagement from './security/GroupManagement';
import RoleManagement from './security/RoleManagement';
import PermissionManagement from './security/PermissionManagement';
import AuditLogs from './security/AuditLogs';
import SecurityDashboard from './security/SecurityDashboard';

const SecurityTab = ({ user, timezone }) => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [hasPermission, setHasPermission] = useState({});

  useEffect(() => {
    // Check user permissions for different sections
    if (user && user.permissions) {
      setHasPermission({
        dashboard: user.permissions.includes('system:admin') || user.permissions.includes('audit:read'),
        users: user.permissions.includes('users:read') || user.permissions.includes('system:admin'),
        groups: user.permissions.includes('groups:read') || user.permissions.includes('system:admin'),
        roles: user.permissions.includes('roles:read') || user.permissions.includes('system:admin'),
        permissions: user.permissions.includes('permissions:read') || user.permissions.includes('system:admin'),
        audit: user.permissions.includes('audit:read') || user.permissions.includes('system:admin'),
        canWrite: user.permissions.includes('system:admin') || 
                 user.permissions.includes('users:write') || 
                 user.permissions.includes('groups:write') || 
                 user.permissions.includes('roles:write')
      });
    }
  }, [user]);

  const sections = [
    { id: 'dashboard', name: 'Security Overview', icon: <FontAwesomeIcon icon={faShieldHalved} className="text-xl mr-2 text-indigo-600" />, permission: 'dashboard' },
    { id: 'users', name: 'User Management', icon: <FontAwesomeIcon icon={faUser} className="text-xl mr-2 text-blue-600" />, permission: 'users' },
    { id: 'groups', name: 'Group Management', icon: <FontAwesomeIcon icon={faUsers} className="text-xl mr-2 text-green-600" />, permission: 'groups' },
    { id: 'roles', name: 'Role Management', icon: <FontAwesomeIcon icon={faUserGear} className="text-xl mr-2 text-purple-600" />, permission: 'roles' },
    { id: 'permissions', name: 'Permissions', icon: <FontAwesomeIcon icon={faKey} className="text-xl mr-2 text-yellow-600" />, permission: 'permissions' },
    { id: 'audit', name: 'Audit Logs', icon: <FontAwesomeIcon icon={faFileLines} className="text-xl mr-2 text-gray-600" />, permission: 'audit' }
  ];

  const availableSections = sections.filter(section => hasPermission[section.permission]);

  // Show loading state if user exists but permissions haven't been loaded yet
  if (user && !user.permissions) {
    return (
      <div className="p-6 text-center">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-medium text-blue-800 mb-2">Loading Security Settings</h3>
          <p className="text-blue-700">
            Please wait while we load your security permissions...
          </p>
        </div>
      </div>
    );
  }

  if (availableSections.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="text-yellow-600 text-6xl mb-4">🔒</div>
          <h3 className="text-lg font-medium text-yellow-800 mb-2">Access Denied</h3>
          <p className="text-yellow-700">
            You don't have permission to access the Security Management section.
            Contact your system administrator to request appropriate permissions.
          </p>
        </div>
      </div>
    );
  }

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return <SecurityDashboard user={user} timezone={timezone} onSectionChange={setActiveSection} />;
      case 'users':
        return <UserManagement user={user} canWrite={hasPermission.canWrite} />;
      case 'groups':
        return <GroupManagement user={user} canWrite={hasPermission.canWrite} />;
      case 'roles':
        return <RoleManagement user={user} canWrite={hasPermission.canWrite} />;
      case 'permissions':
        return <PermissionManagement user={user} canWrite={hasPermission.canWrite} />;
      case 'audit':
        return <AuditLogs user={user} timezone={timezone} />;
      default:
        return <SecurityDashboard user={user} timezone={timezone} onSectionChange={setActiveSection} />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Security Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-2 py-2" aria-label="Security sections">
            {availableSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center px-4 py-2 rounded-lg font-medium text-base whitespace-nowrap transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                  ${activeSection === section.id
                    ? 'bg-indigo-50 text-indigo-700 shadow border border-indigo-200'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-indigo-600 border border-transparent'}
                `}
              >
                <span className="mr-2" role="img" aria-label={section.name}>
                  {section.icon}
                </span>
                {section.name}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Active Section Content */}
      <div className="flex-1 overflow-auto">
        {renderActiveSection()}
      </div>
    </div>
  );
};

export default SecurityTab;