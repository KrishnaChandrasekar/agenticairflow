import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../utils/api';

const UserManagement = ({ user, canWrite }) => {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [showUserFilterDropdown, setShowUserFilterDropdown] = useState(false);

  useEffect(() => {
    fetchUsers();
    if (canWrite) {
      fetchGroups();
      fetchRoles();
    }
  }, [canWrite]);

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/users`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
      } else {
        throw new Error('Failed to fetch users');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/groups`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups);
      }
    } catch (err) {
      console.error('Failed to fetch groups:', err);
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

  const handleCreateUser = async (userData) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        setShowCreateModal(false);
        fetchUsers();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create user');
      }
    } catch (err) {
      alert(`Error creating user: ${err.message}`);
    }
  };

  const handleUpdateUser = async (userId, userData) => {
    try {
      const response = await fetch(`/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        setShowEditModal(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update user');
      }
    } catch (err) {
      alert(`Error updating user: ${err.message}`);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      const response = await fetch(`/api/auth/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        fetchUsers();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete user');
      }
    } catch (err) {
      alert(`Error deleting user: ${err.message}`);
    }
  };

  const handleToggleUserStatus = async (userId, isActive) => {
    try {
      const response = await fetch(`/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ is_active: !isActive })
      });

      if (response.ok) {
        fetchUsers();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update user status');
      }
    } catch (err) {
      alert(`Error updating user status: ${err.message}`);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = !searchTerm || 
      u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email && u.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (u.first_name && u.first_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (u.last_name && u.last_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesFilter = filterActive === 'all' ||
      (filterActive === 'active' && u.is_active) ||
      (filterActive === 'inactive' && !u.is_active) ||
      (filterActive === 'locked' && u.is_locked);
    
    return matchesSearch && matchesFilter;
  });

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
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
                    <p className="mt-1 text-base text-gray-500">
            Manage user accounts and their associated groups and roles.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-base font-medium"
          >
            Create User
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        {/* Custom dropdown for user filter, styled like JobsTab Rows Per Page */}
        <div className="relative min-w-[180px]" style={{width:'180px'}}>
          <button
            type="button"
            onClick={() => setShowUserFilterDropdown((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 pr-10 bg-white border border-blue-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer w-full text-left"
          >
            <span>{
              filterActive === 'all' ? 'All Users' :
              filterActive === 'active' ? 'Active Only' :
              filterActive === 'inactive' ? 'Inactive Only' :
              filterActive === 'locked' ? 'Locked Only' : 'All Users'
            }</span>
          </button>
          <svg className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-200 ${showUserFilterDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {showUserFilterDropdown && (
            <div className="absolute top-full left-0 mt-2 w-full bg-white border border-blue-200 rounded-lg shadow-lg z-50 overflow-hidden">
              {[
                { value: 'all', label: 'All Users' },
                { value: 'active', label: 'Active Only' },
                { value: 'inactive', label: 'Inactive Only' },
                { value: 'locked', label: 'Locked Only' }
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setFilterActive(option.value); setShowUserFilterDropdown(false); }}
                  className={`w-full text-left px-4 py-3 text-sm font-medium transition-all duration-150 ${
                    filterActive === option.value 
                      ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' 
                      : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  {option.label}
                  {filterActive === option.value && (
                    <span className="ml-auto flex items-center">
                      <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {filteredUsers.map((userItem) => (
            <li key={userItem.id}>
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                        <span className="text-base font-medium text-gray-700">
                          {userItem.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="flex items-center">
                        <p className="text-base font-medium text-gray-900">
                          {userItem.first_name && userItem.last_name 
                            ? `${userItem.first_name} ${userItem.last_name}`
                            : userItem.username}
                        </p>
                        <div className="ml-2 flex space-x-1">
                          {!userItem.is_active && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-red-100 text-red-800">
                              Inactive
                            </span>
                          )}
                          {userItem.is_locked && (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                              Pending
                            </span>
                          )}
                          {userItem.must_change_password && (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                              Locked
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center text-base text-gray-500">
                        <p>@{userItem.username}</p>
                        {userItem.email && (
                          <>
                            <span className="mx-2">•</span>
                            <p>{userItem.email}</p>
                          </>
                        )}
                      </div>
                      <div className="mt-1">
                        <div className="flex flex-wrap gap-1">
                          {userItem.groups.map((group, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-blue-100 text-blue-800"
                            >
                              {group.display_name || group.name}
                            </span>
                          ))}
                          {userItem.roles.map((role, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-purple-100 text-purple-800"
                            >
                              {role.display_name || role.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleToggleUserStatus(userItem.id, userItem.is_active)}
                        className={`px-3 py-1 rounded text-sm font-medium ${
                          userItem.is_active
                            ? 'bg-red-100 text-red-800 hover:bg-red-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        {userItem.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedUser(userItem);
                          setShowEditModal(true);
                        }}
                        className="bg-gray-100 text-gray-800 hover:bg-gray-200 px-3 py-1 rounded text-sm font-medium"
                      >
                        Edit
                      </button>
                      {userItem.id !== user.id && (
                        <button
                          onClick={() => handleDeleteUser(userItem.id)}
                          className="bg-red-100 text-red-800 hover:bg-red-200 px-3 py-1 rounded text-sm font-medium"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <span>Created: {new Date(userItem.created_at).toLocaleDateString()}</span>
                  {userItem.last_login && (
                    <>
                      <span className="mx-2">•</span>
                      <span>Last login: {new Date(userItem.last_login).toLocaleString()}</span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500">No users found matching your criteria.</div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <UserModal
          title="Create New User"
          onSave={handleCreateUser}
          onCancel={() => setShowCreateModal(false)}
          groups={groups}
          roles={roles}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <UserModal
          title="Edit User"
          user={selectedUser}
          onSave={(userData) => handleUpdateUser(selectedUser.id, userData)}
          onCancel={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          groups={groups}
          roles={roles}
        />
      )}
    </div>
  );
};

// User Modal Component
const UserModal = ({ title, user, onSave, onCancel, groups, roles }) => {
  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || '',
    password: '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: user?.phone || '',
    group_ids: user?.groups?.map(g => g.id) || [],
    role_ids: user?.roles?.map(r => r.id) || [],
    is_active: user?.is_active ?? true,
    must_change_password: user?.must_change_password || false
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = { ...formData };
    if (!submitData.password && user) {
      delete submitData.password; // Don't send empty password for updates
    }
    onSave(submitData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Username *</label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                disabled={!!user}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">First Name</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Last Name</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700">
              Password {!user && '*'}
            </label>
            <input
              type="password"
              required={!user}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder={user ? "Leave blank to keep current password" : ""}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Groups</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2">
                {groups.map((group) => (
                  <label key={group.id} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.group_ids.includes(group.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            group_ids: [...formData.group_ids, group.id]
                          });
                        } else {
                          setFormData({
                            ...formData,
                            group_ids: formData.group_ids.filter(id => id !== group.id)
                          });
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm">{group.display_name || group.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2">
                {roles.map((role) => (
                  <label key={role.id} className="flex items-center">
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
                      className="mr-2"
                    />
                    <span className="text-sm">{role.display_name || role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-6 space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm">Active user</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.must_change_password}
                onChange={(e) => setFormData({ ...formData, must_change_password: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm">Must change password on next login</span>
            </label>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {user ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserManagement;