import React, { useState, useEffect } from 'react';

const RolePermissionsModal = ({ role, permissions, onClose, canWrite, onPermissionsChange }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Handle Esc key to close modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const rolePermissionIds = role.permissions?.map(p => p.id) || [];

  const handleAddPermission = async (permissionId) => {
    if (!canWrite) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/auth/roles/${role.id}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permission_id: permissionId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to add permission');
      }

      // Refresh the roles data
      onPermissionsChange();
    } catch (err) {
      console.error('Error adding permission:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePermission = async (permissionId) => {
    if (!canWrite) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/auth/roles/${role.id}/permissions/${permissionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to remove permission');
      }

      // Refresh the roles data
      onPermissionsChange();
    } catch (err) {
      console.error('Error removing permission:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const groupedPermissions = permissions.reduce((acc, permission) => {
    const category = permission.category || 'General';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(permission);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        <div className="mt-3">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">
                Permissions for "{role.display_name || role.name}"
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {role.permissions?.length || 0} of {permissions.length} permissions assigned
                {role.is_system && (
                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    System Role
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 -mt-1"
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

          {/* Permissions List */}
          <div className="max-h-96 overflow-y-auto">
            {Object.entries(groupedPermissions).map(([category, categoryPermissions]) => (
              <div key={category} className="mb-6">
                <h4 className="text-lg font-medium text-gray-900 mb-3 sticky top-0 bg-white py-2 border-b border-gray-200">
                  {category}
                </h4>
                <div className="space-y-2">
                  {categoryPermissions.map((permission) => {
                    const hasPermission = rolePermissionIds.includes(permission.id);
                    
                    return (
                      <div
                        key={permission.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          hasPermission 
                            ? 'bg-green-50 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center">
                            {hasPermission ? (
                              <div className="flex-shrink-0 mr-3">
                                <div className="h-5 w-5 rounded-full bg-green-100 flex items-center justify-center">
                                  <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-shrink-0 mr-3">
                                <div className="h-5 w-5 rounded-full bg-gray-200"></div>
                              </div>
                            )}
                            <div>
                              <h5 className="text-sm font-medium text-gray-900">
                                {permission.display_name || permission.name}
                              </h5>
                              {permission.description && (
                                <p className="text-sm text-gray-600">{permission.description}</p>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {canWrite && !role.is_system && (
                          <div className="flex-shrink-0 ml-4">
                            {hasPermission ? (
                              <button
                                onClick={() => handleRemovePermission(permission.id)}
                                disabled={loading}
                                className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAddPermission(permission.id)}
                                disabled={loading}
                                className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                              >
                                Add
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex justify-end pt-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RolePermissionsModal;