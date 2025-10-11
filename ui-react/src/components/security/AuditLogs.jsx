import { API_BASE, fmtDate } from '../../utils/api';
import Dropdown from '../Dropdown';
import React, { useState, useEffect } from 'react';

const AuditLogs = ({ user, timezone }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Debug: Log timezone changes
  useEffect(() => {
    console.log('🕒 AuditLogs: Timezone changed to:', timezone);
  }, [timezone]);
  const [filters, setFilters] = useState({
    user_id: '',
    action: '',
    resource: '',
    success: 'all',
    start_date: '',
    end_date: ''
  });

  useEffect(() => {
    fetchAuditLogs();
  }, [filters]);

  // Force re-render when timezone changes to update timestamp formatting
  useEffect(() => {
    // This effect will trigger a re-render when timezone changes
    // No need to fetch data again, just re-render with new timezone formatting
  }, [timezone]);

  const fetchAuditLogs = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all') {
          params.append(key, value);
        }
      });

      const response = await fetch(`/api/auth/audit-logs?${params}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setLogs(data.audit_logs);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading audit logs...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
                <p className="mt-1 text-base text-gray-500">
          View system audit logs and user activity
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <input
            type="text"
            placeholder="Filter by action..."
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="text"
            placeholder="Filter by resource..."
            value={filters.resource}
            onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <Dropdown
            options={[
              { value: 'all', label: 'All Events' },
              { value: 'true', label: 'Success Only' },
              { value: 'false', label: 'Failures Only' },
            ]}
            value={filters.success}
            onChange={(value) => setFilters({ ...filters, success: value })}
            placeholder="All Events"
            width="140px"
          />
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {logs.map((log) => (
            <li key={log.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className={`flex-shrink-0 w-2 h-2 rounded-full ${
                    log.success ? 'bg-green-400' : 'bg-red-400'
                  }`}></div>
                  <div className="ml-4">
                    <div className="flex items-center">
                      <p className="text-base font-medium text-gray-900">
                        {log.username || 'System'}
                      </p>
                      <span className="mx-2 text-gray-400">•</span>
                      <p className="text-base text-gray-600">
                        {log.action.replace(/_/g, ' ')}
                      </p>
                      {log.resource && (
                        <>
                          <span className="mx-2 text-gray-400">•</span>
                          <p className="text-base text-gray-500">{log.resource}</p>
                        </>
                      )}
                    </div>
                    <div className="mt-1 flex items-center text-sm text-gray-500">
                      <span>{log.timestamp ? fmtDate(log.timestamp, timezone) : ''}</span>
                      {log.ip_address && (
                        <>
                          <span className="mx-2">•</span>
                          <span>{log.ip_address}</span>
                        </>
                      )}
                    </div>
                    {!log.success && log.error_message && (
                      <p className="mt-1 text-base text-red-600">
                        Error: {log.error_message}
                      </p>
                    )}
                  </div>
                </div>
                {log.details && (
                  <div className="text-sm text-gray-400">
                    <button
                      onClick={() => alert(JSON.stringify(log.details, null, 2))}
                      className="hover:text-gray-600"
                    >
                      Details
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {logs.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500">No audit logs found matching your criteria.</div>
        </div>
      )}
    </div>
  );
};

export default AuditLogs;