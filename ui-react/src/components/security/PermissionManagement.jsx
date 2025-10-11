import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';

const PermissionManagement = ({ user, canWrite }) => {
  const [permissions, setPermissions] = useState({});
  const [allPermissions, setAllPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPermissions();
  }, []);

  const fetchPermissions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/permissions`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPermissions(data.permissions);
        setAllPermissions(data.all_permissions);
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading permissions...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Permission Management</h1>
        <p className="mt-1 text-base text-gray-500">
          View and manage system permissions grouped by resource
        </p>
      </div>

      <div className="space-y-6">
        {Object.entries(permissions).map(([resource, resourcePermissions]) => (
          <div key={resource} className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900 capitalize">
                {resource} Permissions
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {resourcePermissions.map((permission) => (
                  <div
                    key={permission.id}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-900">
                        {permission.display_name || permission.name}
                      </h4>
                      {permission.is_system && (
                        <span className="px-2 py-1 text-base bg-blue-100 text-blue-800 rounded">
                          {permission.resource}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-base text-gray-600 mb-2">
                      Action: <code className="bg-gray-100 px-1 rounded">{permission.action}</code>
                    </p>
                    
                    {permission.description && (
                      <p className="text-base text-gray-500">{permission.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PermissionManagement;