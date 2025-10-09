import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';

const GroupManagement = ({ user, canWrite }) => {
  const [groups, setGroups] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchGroups();
    if (canWrite) {
      fetchRoles();
    }
  }, [canWrite]);

  const fetchGroups = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/groups`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups);
      } else {
        throw new Error('Failed to fetch groups');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/roles`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setRoles(data.roles);
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  };

  const handleCreateGroup = async (groupData) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(groupData)
      });

      if (response.ok) {
        setShowCreateModal(false);
        fetchGroups();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create group');
      }
    } catch (err) {
      alert(`Error creating group: ${err.message}`);
    }
  };

  const handleUpdateGroup = async (groupId, groupData) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(groupData)
      });

      if (response.ok) {
        setShowEditModal(false);
        setSelectedGroup(null);
        fetchGroups();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update group');
      }
    } catch (err) {
      alert(`Error updating group: ${err.message}`);
    }
  };

  const handleDeleteGroup = async (groupId, groupName) => {
    if (!confirm(`Are you sure you want to delete the group "${groupName}"?`)) return;

    try {
      const response = await fetch(`/api/auth/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        fetchGroups();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete group');
      }
    } catch (err) {
      alert(`Error deleting group: ${err.message}`);
    }
  };

  const filteredGroups = groups.filter(group =>
    !searchTerm ||
    group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (group.display_name && group.display_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (group.description && group.description.toLowerCase().includes(searchTerm.toLowerCase()))
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
          <h1 className="text-2xl font-bold text-gray-900">Group Management</h1>
                    <p className="mt-1 text-base text-gray-500">
            Organize users into groups for easier permission management.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-base font-medium"
          >
            Create Group
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search groups..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Groups Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredGroups.map((group) => (
          <div
            key={group.id}
            className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-base font-medium text-indigo-600">
                        🏢
                      </span>
                    </div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-gray-900">
                      {group.display_name || group.name}
                    </h3>
                    {group.display_name && group.display_name !== group.name && (
                      <p className="text-base text-gray-500">@{group.name}</p>
                    )}
                  </div>
                </div>
                {group.is_system && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-medium bg-blue-100 text-blue-800">
                    System
                  </span>
                )}
              </div>

              {group.description && (
                <p className="text-base text-gray-600 mb-4">{group.description}</p>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-base font-medium text-gray-700 mb-1">Roles</p>
                  {group.roles && group.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {group.roles.map((role, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 rounded text-base font-medium bg-purple-100 text-purple-800"
                        >
                          {role.display_name || role.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-base text-gray-400">No roles assigned</p>
                  )}
                </div>

                <div>
                  <p className="text-base font-medium text-gray-700">
                    Members: <span className="font-normal">{group.user_count || 0}</span>
                  </p>
                </div>

                <div className="text-sm text-gray-500">
                  Created: {new Date(group.created_at).toLocaleDateString()}
                </div>
              </div>

              {canWrite && !group.is_system && (
                <div className="mt-4 flex justify-end space-x-2">
                  <button
                    onClick={() => {
                      setSelectedGroup(group);
                      setShowEditModal(true);
                    }}
                    className="text-indigo-600 hover:text-indigo-500 text-base font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id, group.display_name || group.name)}
                    className="text-red-600 hover:text-red-500 text-base font-medium"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredGroups.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500">No groups found matching your criteria.</div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateModal && (
        <GroupModal
          title="Create New Group"
          onSave={handleCreateGroup}
          onCancel={() => setShowCreateModal(false)}
          roles={roles}
        />
      )}

      {/* Edit Group Modal */}
      {showEditModal && selectedGroup && (
        <GroupModal
          title="Edit Group"
          group={selectedGroup}
          onSave={(groupData) => handleUpdateGroup(selectedGroup.id, groupData)}
          onCancel={() => {
            setShowEditModal(false);
            setSelectedGroup(null);
          }}
          roles={roles}
        />
      )}
    </div>
  );
};

// Group Modal Component
const GroupModal = ({ title, group, onSave, onCancel, roles }) => {
  const [formData, setFormData] = useState({
    name: group?.name || '',
    display_name: group?.display_name || '',
    description: group?.description || '',
    role_ids: group?.roles?.map(r => r.id) || []
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          </div>
          
          <div className="mb-4">
            <label className="block text-base font-medium text-gray-700">Group Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="e.g., developers, admins, operators"
              disabled={group?.is_system}
            />
            <p className="mt-1 text-base text-gray-500">
              Unique identifier for the group (lowercase, no spaces)
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-base font-medium text-gray-700">Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="e.g., Developers, System Administrators"
            />
            <p className="mt-1 text-base text-gray-500">
              Human-readable name for the group
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-base font-medium text-gray-700">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Describe the purpose and responsibilities of this group..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-base font-medium text-gray-700 mb-2">Assigned Roles</label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-300 rounded-md p-3">
              {roles.length > 0 ? (
                roles.map((role) => (
                  <label key={role.id} className="flex items-start">
                    <input
                      type="checkbox"
                      checked={formData.role_ids.includes(role.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            role_ids: [...formData.role_ids, role.id]
                          });
                        } else {
                          setFormData({
                            ...formData,
                            role_ids: formData.role_ids.filter(id => id !== role.id)
                          });
                        }
                      }}
                      className="mt-0.5 mr-3"
                    />
                    <div>
                      <span className="text-base font-medium">
                        {role.display_name || role.name}
                      </span>
                      {role.description && (
                        <p className="text-sm text-gray-500 mt-0.5">
                          {role.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))
              ) : (
                <p className="text-base text-gray-500">No roles available</p>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Select roles to assign to all members of this group
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-base font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {group ? 'Update Group' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GroupManagement;