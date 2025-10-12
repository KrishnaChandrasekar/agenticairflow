import { API_BASE } from '../../utils/api';
import React, { useState, useEffect } from 'react';
import Dropdown from '../Dropdown';

const GroupManagement = ({ user, canWrite }) => {
  // All state declarations at the top
  const [groups, setGroups] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Advanced filtering state
  const [filterRole, setFilterRole] = useState('');
  const [filterSystem, setFilterSystem] = useState('all');
  const [filterMemberCount, setFilterMemberCount] = useState('all');
  // No longer needed: dropdown open states
  
  // Member management state
  const [members, setMembers] = useState({}); // { groupId: [user, ...] }
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  
  // Permissions management state
  const [permissions, setPermissions] = useState({}); // { groupId: [permission, ...] }
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [activePermissionsGroupId, setActivePermissionsGroupId] = useState(null);

  useEffect(() => {
    fetchGroups();
    fetchAvailablePermissions(); // Always fetch permissions for display
    if (canWrite) {
      fetchRoles();
      fetchUsers();
    }
  }, [canWrite]);

  // Fetch members for a group
  const fetchGroupMembers = async (groupId) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/members`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setMembers((prev) => ({ ...prev, [groupId]: data.members }));
      }
    } catch (err) {
      console.error('Failed to fetch group members:', err);
    }
  };

  // Add member to group
  const handleAddMember = async (groupId, userId) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_id: userId })
      });
      if (response.ok) {
        fetchGroupMembers(groupId);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add member');
      }
    } catch (err) {
      alert(`Error adding member: ${err.message}`);
    }
  };

  // Remove member from group
  const handleRemoveMember = async (groupId, userId) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        fetchGroupMembers(groupId);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove member');
      }
    } catch (err) {
      alert(`Error removing member: ${err.message}`);
    }
  };

  // Fetch permissions for a group
  const fetchGroupPermissions = async (groupId) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/permissions`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setPermissions((prev) => ({ ...prev, [groupId]: data.permissions }));
      }
    } catch (err) {
      console.error('Failed to fetch group permissions:', err);
    }
  };

  // Add permission to group
  const handleAddPermission = async (groupId, permissionName) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permission_name: permissionName })
      });
      if (response.ok) {
        fetchGroupPermissions(groupId);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add permission');
      }
    } catch (err) {
      alert(`Error adding permission: ${err.message}`);
    }
  };

  // Remove permission from group
  const handleRemovePermission = async (groupId, permissionId) => {
    try {
      const response = await fetch(`/api/auth/groups/${groupId}/permissions/${permissionId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        fetchGroupPermissions(groupId);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove permission');
      }
    } catch (err) {
      alert(`Error removing permission: ${err.message}`);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch(`/api/auth/groups`, {
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
      const response = await fetch(`/api/auth/roles`, {
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

  const fetchUsers = async () => {
    try {
      const response = await fetch(`/api/auth/users`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setAvailableUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchAvailablePermissions = async () => {
    try {
      const response = await fetch(`/api/auth/permissions`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        // Use all_permissions array which contains all system permissions
        setAvailablePermissions(Array.isArray(data.all_permissions) ? data.all_permissions : []);
      }
    } catch (err) {
      console.error('Failed to fetch available permissions:', err);
      setAvailablePermissions([]); // Ensure it's always an array
    }
  };

  const handleCreateGroup = async (groupData) => {
    try {
      const response = await fetch(`/api/auth/groups`, {
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
    (!searchTerm ||
      group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (group.display_name && group.display_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (group.description && group.description.toLowerCase().includes(searchTerm.toLowerCase()))
    ) &&
    (filterRole === '' || (group.roles && group.roles.some(r => r.id === filterRole))) &&
    (filterSystem === 'all' || (filterSystem === 'system' ? group.is_system : !group.is_system)) &&
    (filterMemberCount === 'all' ||
      (filterMemberCount === '0' && (group.user_count || 0) === 0) ||
      (filterMemberCount === '1-5' && (group.user_count || 0) >= 1 && (group.user_count || 0) <= 5) ||
      (filterMemberCount === '6-20' && (group.user_count || 0) >= 6 && (group.user_count || 0) <= 20) ||
      (filterMemberCount === '>20' && (group.user_count || 0) > 20))
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

      {/* Search and Filters */}
      <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
        <input
          type="text"
          placeholder="Search groups..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
        <Dropdown
          options={[{ value: '', label: 'All Roles' }, ...roles.map(role => ({ value: role.id, label: role.display_name || role.name }))]}
          value={filterRole}
          onChange={setFilterRole}
          placeholder="All Roles"
          width="180px"
        />
        <Dropdown
          options={[{ value: 'all', label: 'All Groups' }, { value: 'system', label: 'System Groups' }, { value: 'custom', label: 'Custom Groups' }]}
          value={filterSystem}
          onChange={setFilterSystem}
          placeholder="All Groups"
          width="180px"
        />
        <Dropdown
          options={[{ value: 'all', label: 'All Member Counts' }, { value: '0', label: 'No Members' }, { value: '1-5', label: '1-5 Members' }, { value: '6-20', label: '6-20 Members' }, { value: '>20', label: 'More than 20' }]}
          value={filterMemberCount}
          onChange={setFilterMemberCount}
          placeholder="All Member Counts"
          width="180px"
        />
          <button
            type="button"
            className="ml-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200 transition"
            onClick={() => {
              setFilterRole('');
              setFilterSystem('all');
              setFilterMemberCount('all');
            }}
          >
            Reset
          </button>
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
                <div className="mt-4 flex justify-between">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setSelectedGroup(group);
                        setShowEditModal(true);
                      }}
                      className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 hover:text-indigo-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id, group.display_name || group.name)}
                      className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setActiveGroupId(group.id);
                        setShowMembersModal(true);
                        fetchGroupMembers(group.id);
                      }}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Members
                    </button>
                    <button
                      onClick={() => {
                        setActivePermissionsGroupId(group.id);
                        setShowPermissionsModal(true);
                        fetchGroupPermissions(group.id);
                      }}
                      className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Permissions
                    </button>
                  </div>
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

      {/* Members Modal */}
      {showMembersModal && (
        <MembersModal
          groupId={activeGroupId}
          members={members[activeGroupId]}
          availableUsers={availableUsers}
          onAdd={handleAddMember}
          onRemove={handleRemoveMember}
          onClose={() => {
            setShowMembersModal(false);
            fetchGroups(); // Refresh the groups list to update member counts
          }}
        />
      )}

      {/* Permissions Modal */}
      {showPermissionsModal && (
        <PermissionsModal
          groupId={activePermissionsGroupId}
          permissions={permissions[activePermissionsGroupId]}
          availablePermissions={availablePermissions}
          onAdd={handleAddPermission}
          onRemove={handleRemovePermission}
          onClose={() => setShowPermissionsModal(false)}
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

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

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

// Redesigned Members Modal with unified add/remove interface
function MembersModal({ groupId, members, availableUsers, onAdd, onRemove, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [pendingChanges, setPendingChanges] = useState(new Map()); // userId -> 'add' | 'remove'
  const [isApplying, setIsApplying] = useState(false);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Create a map of current members for quick lookup
  const currentMemberIds = new Set((members || []).map(m => m.id));
  
  // Get all users and filter based on search term
  const allUsers = availableUsers || [];
  const filteredUsers = allUsers.filter(user =>
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (user.first_name && user.first_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (user.last_name && user.last_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Determine if a user should be checked (is member or pending add, and not pending remove)
  const isUserChecked = (userId) => {
    const change = pendingChanges.get(userId);
    const isCurrentMember = currentMemberIds.has(userId);
    
    if (change === 'add') return true;
    if (change === 'remove') return false;
    return isCurrentMember;
  };

  // Handle checkbox change
  const handleUserToggle = (userId, checked) => {
    const isCurrentMember = currentMemberIds.has(userId);
    const newChanges = new Map(pendingChanges);
    
    if (checked && !isCurrentMember) {
      // Want to add user who isn't currently a member
      newChanges.set(userId, 'add');
    } else if (!checked && isCurrentMember) {
      // Want to remove user who is currently a member
      newChanges.set(userId, 'remove');
    } else {
      // Reverting to original state
      newChanges.delete(userId);
    }
    
    setPendingChanges(newChanges);
  };

  // Apply all pending changes
  const handleApplyChanges = async () => {
    setIsApplying(true);
    try {
      for (const [userId, action] of pendingChanges) {
        const user = allUsers.find(u => u.id === userId);
        if (!user) continue;
        
        if (action === 'add') {
          await onAdd(groupId, userId);
        } else if (action === 'remove') {
          await onRemove(groupId, userId);
        }
      }
      setPendingChanges(new Map());
    } catch (error) {
      console.error('Error applying changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  // Get counts for display
  const addCount = Array.from(pendingChanges.values()).filter(action => action === 'add').length;
  const removeCount = Array.from(pendingChanges.values()).filter(action => action === 'remove').length;
  const currentMemberCount = members ? members.length : 0;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-3xl shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Manage Group Members</h3>
            <p className="text-sm text-gray-500">
              Check/uncheck users to add or remove them from the group
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full text-xl font-semibold transition-colors"
          >
            ×
          </button>
        </div>

        {/* Status Summary */}
        <div className="mb-4 flex items-center justify-between bg-gray-50 rounded-lg p-3">
          <div className="flex items-center space-x-6">
            <div className="text-sm">
              <span className="font-medium text-gray-700">Current Members:</span>
              <span className="ml-1 text-indigo-600 font-semibold">{currentMemberCount}</span>
            </div>
            {(addCount > 0 || removeCount > 0) && (
              <div className="flex items-center space-x-4">
                {addCount > 0 && (
                  <div className="text-sm">
                    <span className="text-green-600 font-medium">+{addCount} to add</span>
                  </div>
                )}
                {removeCount > 0 && (
                  <div className="text-sm">
                    <span className="text-red-600 font-medium">-{removeCount} to remove</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {pendingChanges.size > 0 && (
            <button
              onClick={handleApplyChanges}
              disabled={isApplying}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                isApplying
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isApplying ? 'Applying...' : `Apply Changes (${pendingChanges.size})`}
            </button>
          )}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search users by username, email, or name..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Users List */}
        <div className="border border-gray-200 rounded-md max-h-96 overflow-y-auto">
          <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              All Users ({filteredUsers.length})
            </span>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  const newChanges = new Map(pendingChanges);
                  filteredUsers.forEach(user => {
                    if (!currentMemberIds.has(user.id)) {
                      newChanges.set(user.id, 'add');
                    } else {
                      newChanges.delete(user.id);
                    }
                  });
                  setPendingChanges(newChanges);
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Add All Visible
              </button>
              <button
                onClick={() => {
                  const newChanges = new Map(pendingChanges);
                  filteredUsers.forEach(user => {
                    if (currentMemberIds.has(user.id)) {
                      newChanges.set(user.id, 'remove');
                    } else {
                      newChanges.delete(user.id);
                    }
                  });
                  setPendingChanges(newChanges);
                }}
                className="text-xs text-red-600 hover:text-red-800 font-medium"
              >
                Remove All Visible
              </button>
              <button
                onClick={() => setPendingChanges(new Map())}
                className="text-xs text-gray-600 hover:text-gray-800 font-medium"
              >
                Reset Changes
              </button>
            </div>
          </div>
          
          <div className="divide-y divide-gray-200">
            {filteredUsers.map((user) => {
              const isChecked = isUserChecked(user.id);
              const isCurrentMember = currentMemberIds.has(user.id);
              const pendingChange = pendingChanges.get(user.id);
              
              return (
                <label key={user.id} className="flex items-center p-3 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleUserToggle(user.id, e.target.checked)}
                    className="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <div className="flex items-center space-x-3 flex-1">
                    <div className="flex-shrink-0">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        isChecked ? 'bg-indigo-100' : 'bg-gray-300'
                      }`}>
                        <span className={`text-sm font-medium ${
                          isChecked ? 'text-indigo-700' : 'text-gray-700'
                        }`}>
                          {user.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{user.username}</p>
                        {isCurrentMember && !pendingChange && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Current Member
                          </span>
                        )}
                        {pendingChange === 'add' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Will Add
                          </span>
                        )}
                        {pendingChange === 'remove' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Will Remove
                          </span>
                        )}
                      </div>
                      {user.email && (
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      )}
                      {(user.first_name || user.last_name) && (
                        <p className="text-xs text-gray-500 truncate">
                          {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                        </p>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {filteredUsers.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No users found matching your search.
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-between">
          <button
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <div className="flex space-x-2">
            {pendingChanges.size > 0 && (
              <button
                onClick={() => setPendingChanges(new Map())}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Reset Changes
              </button>
            )}
            <button
              onClick={handleApplyChanges}
              disabled={pendingChanges.size === 0 || isApplying}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                pendingChanges.size === 0 || isApplying
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isApplying ? 'Applying Changes...' : 'Apply Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Permissions Modal
function PermissionsModal({ groupId, permissions, availablePermissions, onAdd, onRemove, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  


  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);



  // Create unified permissions list that includes all available permissions
  const safeAvailablePermissions = Array.isArray(availablePermissions) ? availablePermissions : [];
  
  // Filter permissions based on search term (show all permissions, not just unassigned ones)
  const filteredPermissions = safeAvailablePermissions.filter(permission =>
    permission.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (permission.description && permission.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSearchInputChange = (e) => {
    setSearchTerm(e.target.value);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-11/12 max-w-5xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Group Permissions</h3>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full text-xl font-semibold transition-colors"
          >
            ×
          </button>
        </div>

        {/* Search and Filter */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">Manage Permissions</h4>
            <div className="text-sm text-gray-500">
              {(permissions || []).length} assigned • {safeAvailablePermissions.length} total available
            </div>
          </div>
          
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchInputChange}
              placeholder="Search permissions by name or description..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>

        {/* Unified Permissions List */}
        <div className="mb-4">
          <div className="border border-gray-200 rounded-md max-h-96 overflow-y-auto">
            <div className="divide-y divide-gray-200">
              {filteredPermissions.map((permission) => {
                const isAssigned = permissions?.some(p => p.id === permission.id) || false;
                return (
                  <div key={permission.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                    <div className="flex items-center space-x-3 flex-1">
                      <div className="flex-shrink-0">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                          isAssigned ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          <span className={`text-sm font-medium ${
                            isAssigned ? 'text-green-700' : 'text-gray-600'
                          }`}>
                            🔐
                          </span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <p className="text-sm font-medium text-gray-900">{permission.name}</p>
                          {isAssigned && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Assigned
                            </span>
                          )}
                        </div>
                        {permission.description && (
                          <p className="text-xs text-gray-500 mt-1">{permission.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {isAssigned ? (
                        <button
                          className="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 rounded-md hover:bg-red-50 border border-red-200"
                          onClick={() => onRemove(groupId, permission.id)}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          className="text-green-600 hover:text-green-800 text-sm font-medium px-3 py-1 rounded-md hover:bg-green-50 border border-green-200"
                          onClick={() => onAdd(groupId, permission.name)}
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {filteredPermissions.length === 0 && (
            <div className="p-4 text-center text-gray-500">
              No permissions found matching "{searchTerm}"
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="flex justify-end">
          <button
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default GroupManagement;