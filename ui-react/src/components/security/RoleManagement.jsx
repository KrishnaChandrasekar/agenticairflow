import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';

const RoleManagement = ({ user, canWrite }) => {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Fetch roles and permissions
    fetchRoles();
    fetchPermissions();
  }, []);

  const fetchRoles = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/roles`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRoles(data.roles);
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  };

  const fetchPermissions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/permissions`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPermissions(data.all_permissions);
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading role management...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
                <p className="mt-1 text-base text-gray-500">
          Manage system roles and their permissions
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role) => (
          <div key={role.id} className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-900">
                {role.display_name || role.name}
              </h3>
              {role.is_system && (
                <span className="px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded">
                  System
                </span>
              )}
            </div>
            
            {role.description && (
              <p className="text-base text-gray-600 mb-4">{role.description}</p>
            )}
            
            <div className="space-y-2">
                            <p className="text-base font-medium text-gray-700">
                Permissions: <span className="font-normal">{role.permissions?.length || 0}</span>
              </p>
              <p className="text-base text-gray-600">
                Users: <span>{role.user_count || 0}</span>
              </p>
              <p className="text-base text-gray-600">
                Groups: <span>{role.group_count || 0}</span>
              </p>
            </div>
            
            {canWrite && !role.is_system && (
              <div className="mt-4 flex space-x-2">
                                <button className="text-indigo-600 hover:text-indigo-500 text-base">
                  View Details
                </button>
                <button className="text-red-600 hover:text-red-500 text-base">
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RoleManagement;