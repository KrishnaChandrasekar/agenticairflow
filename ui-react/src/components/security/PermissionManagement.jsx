import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';


const PermissionManagement = ({ user, canWrite }) => {
  const [permissions, setPermissions] = useState({});
  const [allPermissions, setAllPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track expanded/collapsed state for each section (must be at top level)
  const [expandedSections, setExpandedSections] = useState({});

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

  const toggleSection = (resource) => {
    setExpandedSections((prev) => ({
      ...prev,
      [resource]: !prev[resource]
    }));
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
            <button
              className="w-full px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between focus:outline-none"
              onClick={() => toggleSection(resource)}
              aria-expanded={!!expandedSections[resource]}
            >
              <h3 className="text-lg font-medium text-gray-900 capitalize">
                {resource} Permissions
              </h3>
              <span className={`ml-2 transition-transform duration-200 ${expandedSections[resource] ? 'rotate-180' : ''}`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {expandedSections[resource] && (
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
                      {canWrite && (
                        <div className="mt-3 flex gap-2">
                          <button
                            className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 text-sm font-medium border border-indigo-200"
                            title="Edit Permission"
                            onClick={() => alert('Edit permission: ' + (permission.display_name || permission.name))}
                          >
                            Edit
                          </button>
                          <button
                            className="px-3 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm font-medium border border-red-200"
                            title="Delete Permission"
                            onClick={() => window.confirm('Delete permission: ' + (permission.display_name || permission.name))}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PermissionManagement;