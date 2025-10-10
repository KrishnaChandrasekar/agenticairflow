import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';
import RoleModal from './RoleModal';
import RolePermissionsModal from './RolePermissionsModal';

const RoleManagement = ({ user, canWrite }) => {
  // All state declarations at the top
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Advanced filtering state
  const [filterType, setFilterType] = useState('all');
  const [filterPermissionCount, setFilterPermissionCount] = useState('all');
  const [filterUserCount, setFilterUserCount] = useState('all');
  
  useEffect(() => {
    fetchRoles();
    fetchPermissions();
  }, []);

  // Handle Esc key to close delete modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && showDeleteModal) {
        setShowDeleteModal(false);
        setRoleToDelete(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDeleteModal]);

  const fetchRoles = async () => {
    try {
      const response = await fetch(`/api/auth/roles`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRoles(data.roles || []);
        setError(null);
      } else {
        throw new Error('Failed to fetch roles');  
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
      setError(err.message);
    }
  };

  const fetchPermissions = async () => {
    try {
      const response = await fetch(`/api/auth/permissions`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPermissions(data.all_permissions || []);
      }
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRole = async (roleData) => {
    try {
      const response = await fetch(`/api/auth/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(roleData)
      });

      if (response.ok) {
        setShowCreateModal(false);
        fetchRoles();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create role');
      }
    } catch (err) {
      alert(`Error creating role: ${err.message}`);
    }
  };

  const handleUpdateRole = async (roleId, roleData) => {
    try {
      const response = await fetch(`/api/auth/roles/${roleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(roleData)
      });

      if (response.ok) {
        setShowEditModal(false);
        setSelectedRole(null);
        fetchRoles();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update role');
      }
    } catch (err) {
      alert(`Error updating role: ${err.message}`);
    }
  };

  const showDeleteConfirmation = (roleId, roleName) => {
    setRoleToDelete({ id: roleId, name: roleName });
    setShowDeleteModal(true);
  };

  const handleDeleteRole = async () => {
    if (!roleToDelete) return;

    try {
      const response = await fetch(`/api/auth/roles/${roleToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        fetchRoles();
        setShowDeleteModal(false);
        setRoleToDelete(null);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete role');
      }
    } catch (err) {
      setError(`Error deleting role: ${err.message}`);
    }
  };

  const filteredRoles = roles.filter(role =>
    (!searchTerm ||
      role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (role.display_name && role.display_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (role.description && role.description.toLowerCase().includes(searchTerm.toLowerCase()))
    ) &&
    (filterType === 'all' || (filterType === 'system' ? role.is_system : !role.is_system)) &&
    (filterPermissionCount === 'all' ||
      (filterPermissionCount === '0' && (role.permissions?.length || 0) === 0) ||
      (filterPermissionCount === '1-5' && (role.permissions?.length || 0) >= 1 && (role.permissions?.length || 0) <= 5) ||
      (filterPermissionCount === '6-15' && (role.permissions?.length || 0) >= 6 && (role.permissions?.length || 0) <= 15) ||
      (filterPermissionCount === '>15' && (role.permissions?.length || 0) > 15)) &&
    (filterUserCount === 'all' ||
      (filterUserCount === '0' && (role.user_count || 0) === 0) ||
      (filterUserCount === '1-10' && (role.user_count || 0) >= 1 && (role.user_count || 0) <= 10) ||
      (filterUserCount === '11-50' && (role.user_count || 0) >= 11 && (role.user_count || 0) <= 50) ||
      (filterUserCount === '>50' && (role.user_count || 0) > 50))
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-red-600">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
          <p className="mt-1 text-base text-gray-500">
            Create and manage roles with specific permissions for users and groups.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-base font-medium"
          >
            Create Role
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
        <input
          type="text"
          placeholder="Search roles..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="min-w-[140px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm font-medium text-gray-700"
        >
          <option value="all">All Types</option>
          <option value="system">System Roles</option>
          <option value="custom">Custom Roles</option>
        </select>
        <select
          value={filterPermissionCount}
          onChange={e => setFilterPermissionCount(e.target.value)}
          className="min-w-[160px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm font-medium text-gray-700"
        >
          <option value="all">All Permissions</option>
          <option value="0">No Permissions</option>
          <option value="1-5">1-5 Permissions</option>
          <option value="6-15">6-15 Permissions</option>
          <option value=">15">More than 15</option>
        </select>
        <select
          value={filterUserCount}
          onChange={e => setFilterUserCount(e.target.value)}
          className="min-w-[150px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm font-medium text-gray-700"
        >
          <option value="all">All User Counts</option>
          <option value="0">No Users</option>
          <option value="1-10">1-10 Users</option>
          <option value="11-50">11-50 Users</option>
          <option value=">50">More than 50</option>
        </select>
      </div>

      {/* Roles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredRoles.map((role) => (
          <div
            key={role.id}
            className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow flex flex-col"
          >
            <div className="px-4 py-5 sm:p-6 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <span className="text-base font-medium text-purple-600">
                        👥
                      </span>
                    </div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-gray-900">
                      {role.display_name || role.name}
                    </h3>
                    {role.display_name && role.display_name !== role.name && (
                      <p className="text-base text-gray-500">@{role.name}</p>
                    )}
                  </div>
                </div>
                {role.is_system && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-medium bg-blue-100 text-blue-800">
                    System
                  </span>
                )}
              </div>

              {role.description && (
                <p className="text-base text-gray-600 mb-4">{role.description}</p>
              )}

              <div className="space-y-3 flex-1">
                <div>
                  <p className="text-base font-medium text-gray-700 mb-1">Permissions</p>
                  {role.permissions && role.permissions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {role.permissions.slice(0, 3).map((permission, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 rounded text-base font-medium bg-green-100 text-green-800"
                        >
                          {permission.display_name || permission.name}
                        </span>
                      ))}
                      {role.permissions.length > 3 && (
                        <button
                          onClick={() => {
                            setSelectedRole(role);
                            setShowPermissionsModal(true);
                          }}
                          className="inline-flex items-center px-2 py-0.5 rounded text-base font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                          title={`View all ${role.permissions.length} permissions for ${role.display_name || role.name}`}
                        >
                          +{role.permissions.length - 3} more
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-base text-gray-400">No permissions assigned</p>
                  )}
                </div>

                <div className="flex justify-between text-base text-gray-600">
                  <span>Users: <strong>{role.user_count || 0}</strong></span>
                  <span>Groups: <strong>{role.group_count || 0}</strong></span>
                </div>

                <div className="text-sm text-gray-500">
                  Created: {new Date(role.created_at).toLocaleDateString()}
                </div>
              </div>

              <div className="mt-4 flex justify-end space-x-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => {
                    setSelectedRole(role);
                    setShowPermissionsModal(true);
                  }}
                  className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Permissions
                </button>
                {canWrite && !role.is_system && (
                  <>
                    <button
                      onClick={() => {
                        setSelectedRole(role);
                        setShowEditModal(true);
                      }}
                      className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 hover:text-indigo-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => showDeleteConfirmation(role.id, role.display_name || role.name)}
                      className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredRoles.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500">No roles found matching your criteria.</div>
        </div>
      )}

      {/* Create Role Modal */}
      {showCreateModal && (
        <RoleModal
          title="Create New Role"
          onSave={handleCreateRole}
          onCancel={() => setShowCreateModal(false)}
          permissions={permissions}
        />
      )}

      {/* Edit Role Modal */}
      {showEditModal && selectedRole && (
        <RoleModal
          title="Edit Role"
          role={selectedRole}
          onSave={(roleData) => handleUpdateRole(selectedRole.id, roleData)}
          onCancel={() => {
            setShowEditModal(false);
            setSelectedRole(null);
          }}
          permissions={permissions}
        />
      )}

      {/* Permissions Modal */}
      {showPermissionsModal && selectedRole && (
        <RolePermissionsModal
          role={selectedRole}
          permissions={permissions}
          onClose={() => {
            setShowPermissionsModal(false);
            setSelectedRole(null);
          }}
          canWrite={canWrite}
          onPermissionsChange={fetchRoles}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && roleToDelete && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-md shadow-lg rounded-md bg-white">
            <div className="mt-3">
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                      <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-semibold text-gray-900">Delete Role</h3>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setRoleToDelete(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 -mt-1"
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="mb-6">
                <p className="text-base text-gray-700">
                  Are you sure you want to delete the role <strong>"{roleToDelete.name}"</strong>?
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  This action cannot be undone. All users and groups assigned to this role will lose their associated permissions.
                </p>
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setRoleToDelete(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteRole}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Delete Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;