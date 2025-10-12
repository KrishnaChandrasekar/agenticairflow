import React, { useState, useEffect } from 'react';
import { API_BASE, fmtDate } from '../../utils/api';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faIdBadge, faKey } from '@fortawesome/free-solid-svg-icons';

const SecurityDashboard = ({ user, timezone, onSectionChange }) => {
  const [stats, setStats] = useState({
    users: { total: 0, active: 0, locked: 0 },
    groups: { total: 0 },
    roles: { total: 0 },
    permissions: { total: 0 },
    recentActivity: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSecurityStats();
  }, []);

  const fetchSecurityStats = async () => {
    try {
      setLoading(true);
      
      // Fetch users stats
      const usersResponse = await fetch(`${API_BASE}/api/auth/users`, {
        credentials: 'include'
      });
      
      // Fetch groups stats
      const groupsResponse = await fetch(`${API_BASE}/api/auth/groups`, {
        credentials: 'include'
      });
      
      // Fetch roles stats
      const rolesResponse = await fetch(`${API_BASE}/api/auth/roles`, {
        credentials: 'include'
      });
      
      // Fetch permissions stats
      const permissionsResponse = await fetch(`${API_BASE}/api/auth/permissions`, {
        credentials: 'include'
      });
      
      // Fetch recent audit logs
      const auditResponse = await fetch(`${API_BASE}/api/auth/audit-logs?per_page=10`, {
        credentials: 'include'
      });

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const activeUsers = usersData.users.filter(u => u.is_active).length;
        const lockedUsers = usersData.users.filter(u => u.is_locked).length;
        
        setStats(prev => ({
          ...prev,
          users: {
            total: usersData.users.length,
            active: activeUsers,
            locked: lockedUsers
          }
        }));
      }

      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json();
        setStats(prev => ({
          ...prev,
          groups: { total: groupsData.groups.length }
        }));
      }

      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json();
        setStats(prev => ({
          ...prev,
          roles: { total: rolesData.roles.length }
        }));
      }

      if (permissionsResponse.ok) {
        const permissionsData = await permissionsResponse.json();
        setStats(prev => ({
          ...prev,
          permissions: { total: permissionsData.all_permissions.length }
        }));
      }

      if (auditResponse.ok) {
        const auditData = await auditResponse.json();
        setStats(prev => ({
          ...prev,
          recentActivity: auditData.audit_logs
        }));
      }

    } catch (err) {
      setError('Failed to fetch security statistics');
      console.error('Security stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, subtitle, icon, color = 'blue' }) => (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className={`text-3xl text-${color}-600`}>
              {icon}
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-base font-medium text-gray-500 truncate">
                {title}
              </dt>
              <dd className="text-lg font-medium text-gray-900">
                {value}
              </dd>
              {subtitle && (
                <dd className="text-base text-gray-500">
                  {subtitle}
                </dd>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );

  const ActivityItem = ({ activity }) => (
    <div className="flex items-start space-x-3 py-3">
      <div className={`flex-shrink-0 w-2 h-2 mt-2 rounded-full ${
        activity.success ? 'bg-green-400' : 'bg-red-400'
      }`}></div>
      <div className="flex-1 min-w-0">
        <p className="text-base text-gray-900">
          <span className="font-medium">{activity.username || 'System'}</span>
          {' '}
          <span className="text-gray-600">{activity.action.replace('_', ' ')}</span>
          {activity.resource && (
            <span className="text-gray-500"> on {activity.resource}</span>
          )}
        </p>
        <p className="text-sm text-gray-500">
          {activity.timestamp ? fmtDate(activity.timestamp, timezone) : ''}
          {activity.ip_address && ` • ${activity.ip_address}`}
        </p>
        {!activity.success && activity.error_message && (
          <p className="text-sm text-red-600 mt-1">
            Error: {activity.error_message}
          </p>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-gray-200 h-32 rounded-lg"></div>
            ))}
          </div>
          <div className="bg-gray-200 h-64 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-red-600 text-base">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Security Overview</h1>
        <p className="mt-1 text-base text-gray-500">
          Monitor your system's security status and recent activity
        </p>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Users"
          value={stats.users.total}
          subtitle={`${stats.users.active} active, ${stats.users.locked} locked`}
          icon={<FontAwesomeIcon icon={faUsers} size="2x" />}
          color="blue"
        />
        <StatCard
          title="Groups"
          value={stats.groups.total}
          subtitle="Organizational units"
          icon={<FontAwesomeIcon icon={faUsers} size="2x" />}
          color="green"
        />
        <StatCard
          title="Roles"
          value={stats.roles.total}
          subtitle="Permission sets"
          icon={<FontAwesomeIcon icon={faIdBadge} size="2x" />}
          color="purple"
        />
        <StatCard
          title="Permissions"
          value={stats.permissions.total}
          subtitle="Access controls"
          icon={<FontAwesomeIcon icon={faKey} size="2x" />}
          color="indigo"
        />
      </div>

      {/* Current User Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Your Access Profile
            </h3>
            <div className="space-y-3">
              <div>
                <span className="text-base font-medium text-gray-500">Username:</span>
                <span className="ml-2 text-base text-gray-900">{user.username}</span>
              </div>
              {user.email && (
                <div>
                  <span className="text-base font-medium text-gray-500">Email:</span>
                  <span className="ml-2 text-base text-gray-900">{user.email}</span>
                </div>
              )}
              <div>
                <span className="text-base font-medium text-gray-500">Groups:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.groups && user.groups.length > 0 ? (
                    user.groups.map((group, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                      >
                        {group.display_name || group.name || group}
                      </span>
                    ))
                  ) : (
                    <span className="text-base text-gray-400">No groups assigned</span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-base font-medium text-gray-500">Permissions:</span>
                <div className="mt-1 max-h-32 overflow-y-auto">
                  {user.permissions && user.permissions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {user.permissions.slice(0, 10).map((permission, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-1 rounded text-sm font-mono bg-gray-100 text-gray-700"
                        >
                          {permission}
                        </span>
                      ))}
                      {user.permissions.length > 10 && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-sm bg-gray-100 text-gray-500">
                          +{user.permissions.length - 10} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-base text-gray-400">No permissions assigned</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* System Security Status */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Security Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-base text-gray-500">Authentication</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base text-gray-500">Session Security</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  Enabled
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base text-gray-500">Audit Logging</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base text-gray-500">Role-Based Access</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  Enabled
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      {stats.recentActivity.length > 0 && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Recent Security Activity
            </h3>
            <div className="flow-root">
              <ul className="divide-y divide-gray-200">
                {stats.recentActivity.map((activity, index) => (
                  <li key={activity.id || index}>
                    <ActivityItem activity={activity} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4">
              <button 
                onClick={() => onSectionChange && onSectionChange('audit')}
                className="text-base text-indigo-600 hover:text-indigo-500 cursor-pointer"
              >
                View all audit logs →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityDashboard;