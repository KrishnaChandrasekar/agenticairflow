import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';


const PermissionManagement = ({ user, canWrite }) => {
  const [permissions, setPermissions] = useState({});
  const [allPermissions, setAllPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track expanded/collapsed state for each section (must be at top level)
  const [expandedSections, setExpandedSections] = useState({});
  const [editModal, setEditModal] = useState({ open: false, permission: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, permission: null });
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  // Edit permission handler
  const handleEditPermission = (permission) => {
    setEditModal({ open: true, permission });
  };

  // Save edited permission
  const handleSaveEdit = async (updatedPermission) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/permissions/${updatedPermission.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPermission)
      });
      if (!response.ok) throw new Error('Failed to update permission');
      setEditModal({ open: false, permission: null });
      fetchPermissions();
    } catch (err) {
      alert('Error updating permission: ' + err.message);
    }
  };

  // Show delete confirmation modal
  const showDeleteConfirmation = (permission) => {
    setDeleteModal({ open: true, permission });
  };

  // Delete permission handler
  const handleDeletePermission = async () => {
    if (!deleteModal.permission) return;
    setDeleteLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/permissions/${deleteModal.permission.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete permission');
      fetchPermissions();
      setDeleteModal({ open: false, permission: null });
    } catch (err) {
      alert('Error deleting permission: ' + err.message);
    } finally {
      setDeleteLoading(false);
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
                            onClick={() => handleEditPermission(permission)}
                          >
                            Edit
                          </button>
                          <button
                            className="px-3 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm font-medium border border-red-200"
                            title="Delete Permission"
                            disabled={deleteLoading}
                            onClick={() => showDeleteConfirmation(permission)}
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
      {/* Edit Modal */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Permission</h2>
            <form
              onSubmit={e => {
                e.preventDefault();
                const form = e.target;
                const updated = {
                  ...editModal.permission,
                  display_name: form.display_name.value,
                  description: form.description.value,
                  action: form.action.value
                };
                handleSaveEdit(updated);
              }}
            >
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700">Display Name</label>
                <input name="display_name" defaultValue={editModal.permission.display_name || ''} className="mt-1 block w-full border border-gray-300 rounded px-2 py-1" />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700">Action</label>
                <input name="action" defaultValue={editModal.permission.action || ''} className="mt-1 block w-full border border-gray-300 rounded px-2 py-1" />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea name="description" defaultValue={editModal.permission.description || ''} className="mt-1 block w-full border border-gray-300 rounded px-2 py-1" />
              </div>
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" className="px-3 py-1 rounded bg-gray-100 text-gray-700" onClick={() => setEditModal({ open: false, permission: null })}>Cancel</button>
                <button type="submit" className="px-3 py-1 rounded bg-indigo-600 text-white font-semibold">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.open && deleteModal.permission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Delete Permission</h3>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm text-gray-700">
                    Are you sure you want to delete the permission <strong>"{deleteModal.permission.display_name || deleteModal.permission.name}"</strong>?
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    This action cannot be undone. All roles using this permission will lose access to the associated functionality.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setDeleteModal({ open: false, permission: null })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePermission}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting...' : 'Delete Permission'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionManagement;