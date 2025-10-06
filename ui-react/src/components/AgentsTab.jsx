import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { fmtDate, fmtAgo, includesAll, matchLabels, fetchJSON, API_BASE, toTs, getAuthHeaders } from '../utils/api';

// Helper functions moved outside component to prevent hoisting issues
const getAgentStatus = (agent, OFFLINE_THRESHOLD_MS) => {
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = Date.now();
  
  if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
    return agent.active ? "Registered" : "Discovered";
  }
  return "Offline";
};

const getAgentAvailability = (agent, OFFLINE_THRESHOLD_MS) => {
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = Date.now();
  
  if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
    return agent.active ? "Active" : "Inactive";
  }
  return "Inactive";
};

const AgentsTab = ({ 
  agents, 
  jobs, 
  timezone, 
  timeRange, 
  filterJobsByTime,
  onTestJobClick, 
  loading, 
  refreshAgents 
}) => {
  const [filters, setFilters] = useState({
    agent_id: '',
    url: '',
    labels: '',
    status: '',
    availability: ''
  });
  
  const [sort, setSort] = useState({ key: 'agent_id', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
  const [banner, setBanner] = useState({ show: false, message: '', type: 'info' });
  const [jobCounts, setJobCounts] = useState({});
  const pageSizeDropdownRef = useRef(null);

  const OFFLINE_THRESHOLD_MS = 20 * 1000;

  // Calculate job counts for each agent in time range
  useEffect(() => {
    const calculateJobCounts = async () => {
      if (!agents || agents.length === 0) {
        setJobCounts({});
        return;
      }

      try {
        const counts = {};
        await Promise.all(agents.map(async agent => {
          try {
            const j = await fetchJSON(`${API_BASE}/jobs?limit=1000&agent_id=${encodeURIComponent(agent.agent_id)}`);
            const arr = Array.isArray(j) ? j : (j.jobs || []);
            
            const filteredJobs = arr.filter(job => {
              if (!timeRange || !timeRange.enabled) return true;
              const field = timeRange.field || 'updated_at';
              const v = job[field];
              const t = toTs(v);
              if (isNaN(t)) return false;
              
              if (timeRange.mode === 'relative') {
                const to = Date.now();
                const from = to - (timeRange.relMins || 1440) * 60 * 1000;
                return t >= from && t <= to;
              } else if (timeRange.abs) {
                const { fromMs, toMs } = timeRange.abs;
                if (fromMs && t < fromMs) return false;
                if (toMs && t > toMs) return false;
                return true;
              }
              return true;
            });
            
            counts[agent.agent_id] = filteredJobs.length;
          } catch (error) {
            console.error(`Error fetching jobs for agent ${agent.agent_id}:`, error);
            counts[agent.agent_id] = 0;
          }
        }));
        setJobCounts(counts);
      } catch (error) {
        console.error('Error calculating job counts:', error);
        setJobCounts({});
      }
    };

    // Add a small delay to prevent rapid re-execution and add safety check
    const timeoutId = setTimeout(() => {
      calculateJobCounts();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [agents?.length, timeRange?.enabled, timeRange?.mode, timeRange?.relMins]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(event.target)) {
        setPageSizeDropdownOpen(false);
      }
    };

    if (pageSizeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [pageSizeDropdownOpen]);

  // Filter and sort agents
  const filteredAgents = useMemo(() => {
    if (!agents || agents.length === 0) return [];
    let filtered = [...agents];
    
    // Apply filters
    if (filters.agent_id) {
      filtered = filtered.filter(a => includesAll(a.agent_id || '', filters.agent_id));
    }
    if (filters.url) {
      filtered = filtered.filter(a => includesAll(a.url || '', filters.url));
    }
    if (filters.labels) {
      filtered = filtered.filter(a => matchLabels(a.labels, filters.labels));
    }
    if (filters.status) {
      filtered = filtered.filter(a => {
        const status = getAgentStatus(a, OFFLINE_THRESHOLD_MS);
        return status === filters.status;
      });
    }
    if (filters.availability) {
      filtered = filtered.filter(a => {
        const availability = getAgentAvailability(a, OFFLINE_THRESHOLD_MS);
        return availability === filters.availability;
      });
    }
    
    // Apply sorting
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let va = a[key] ?? '';
      let vb = b[key] ?? '';
      
      if (key === 'jobs_in_range') {
        va = jobCounts[a.agent_id] || 0;
        vb = jobCounts[b.agent_id] || 0;
      }
      
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      if (key.endsWith('_at') || key === 'last_heartbeat') return (new Date(va) - new Date(vb)) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
    
    return filtered;
  }, [agents, filters, sort, jobCounts]);

  // Paginate agents
  const paginatedAgents = useMemo(() => {
    const total = filteredAgents.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, pages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    
    return {
      agents: filteredAgents.slice(start, end),
      total,
      pages,
      currentPage,
      start: total ? start + 1 : 0,
      end: Math.min(end, total)
    };
  }, [filteredAgents, page, pageSize]);

  // Filter chips
  const filterChips = useMemo(() => {
    const chips = [];
    Object.entries(filters).forEach(([k, v]) => {
      if (v != null && String(v).trim() !== '') {
        chips.push({ key: k, value: String(v).trim() });
      }
    });
    
    // Add time range chip
    if (timeRange.enabled) {
      const fieldLabel = timeRange.field === 'created_at' ? 'Created' : 'Updated';
      let label = `${fieldLabel}: All time`;
      if (timeRange.mode === 'relative') {
        const mins = timeRange.relMins;
        let rangeText = '';
        if (mins % (24 * 60) === 0) rangeText = `Last ${mins / (24 * 60)}d`;
        else if (mins % 60 === 0) rangeText = `Last ${mins / 60}h`;
        else rangeText = `Last ${mins}m`;
        label = `${fieldLabel} in ${rangeText}`;
      }
      chips.unshift({ key: 'timerange', value: label });
    }
    
    return chips;
  }, [filters, timeRange]);

  // Convert useCallback to regular function to prevent circular dependencies
  const removeFilterChip = (chipKey) => {
    if (chipKey === 'timerange') {
      // Clear time range filter - AgentsTab doesn't have onTimeRangeClear prop, so we skip this
      return;
    }
    // Inline handleFilterChange call to avoid circular dependency
    setFilters(prev => ({ ...prev, [chipKey]: '' }));
    setPage(1);
  };

  // Convert useCallback to regular functions to prevent circular dependencies
  const handleSort = (key) => {
    setSort(prev => ({
      key,
      dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc'
    }));
    setPage(1);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({
      agent_id: '',
      url: '',
      labels: '',
      status: '',
      availability: ''
    });
    setPage(1);
  };

  const deregisterAgent = async (agentId) => {
    setBanner({
      show: true,
      type: 'confirm',
      message: `Deregister agent ${agentId}?`,
      agentId
    });
  };

  const confirmDeregister = async (agentId) => {
    setBanner({ show: true, type: 'loading', message: 'Processing...' });
    
    try {
      const resp = await fetch(`${API_BASE}/agents/deregister`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ agent_id: agentId })
      });
      const data = await resp.json();
      
      if (data.ok) {
        setBanner({
          show: true,
          type: 'success',
          message: `Agent ${agentId} deregistered.`
        });
        setTimeout(() => setBanner({ show: false }), 2500);
        refreshAgents();
      } else {
        setBanner({
          show: true,
          type: 'error',
          message: `Error: ${data.error || "Unknown error"}`
        });
      }
    } catch (e) {
      setBanner({
        show: true,
        type: 'error',
        message: `Request failed: ${e.message}`
      });
    }
  };

  const getSortIndicator = (key) => {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? '▲' : '▼';
  };

  const formatRangeLabel = () => {
    const fieldLabel = timeRange.field === 'created_at' ? 'Created' : 'Updated';
    if (!timeRange.enabled) return `Jobs (${fieldLabel}: All time)`;
    
    if (timeRange.mode === 'relative') {
      const mins = timeRange.relMins;
      let rangeText = '';
      if (mins % (24 * 60) === 0) rangeText = `Last ${mins / (24 * 60)}d`;
      else if (mins % 60 === 0) rangeText = `Last ${mins / 60}h`;
      else rangeText = `Last ${mins}m`;
      return `Jobs (${fieldLabel} in ${rangeText})`;
    }
    
    return `Jobs (${fieldLabel} in range)`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-secondary text-body">Loading agents...</div>
      </div>
    );
  }

  // Add error boundary for the component
  if (!agents) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">Loading agents...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Banner */}
      {banner.show && (
        <div className={`mb-4 p-4 rounded-xl text-body shadow-md hover:shadow-lg transition-all duration-300 ${
          banner.type === 'success' ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border-2 border-green-300' :
          banner.type === 'error' ? 'bg-gradient-to-r from-red-50 to-pink-50 text-red-800 border-2 border-red-300' :
          banner.type === 'confirm' ? 'bg-gradient-to-r from-amber-50 to-orange-50 text-orange-800 border-2 border-orange-300' :
          'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-800 border-2 border-blue-300'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {banner.type === 'confirm' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-100 to-amber-100 border-2 border-orange-300 flex items-center justify-center">
                  <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
              )}
              <span className="font-medium">{banner.message}</span>
            </div>
            {banner.type === 'confirm' && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => confirmDeregister(banner.agentId)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 rounded-lg text-red-800 btn-text-small hover:from-red-200 hover:to-pink-200 hover:border-red-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Confirm
                </button>
                <button 
                  onClick={() => setBanner({ show: false })}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-slate-100 to-gray-100 border-2 border-slate-300 rounded-lg text-slate-700 btn-text-small hover:from-slate-200 hover:to-gray-200 hover:border-slate-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter chips - Modern React styling */}
      {filterChips.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4 p-2">
          {filterChips.map(chip => (
            <div 
              key={chip.key} 
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-full text-sm font-medium text-blue-800 shadow-sm hover:shadow-md transition-all duration-200 hover:from-blue-100 hover:to-indigo-100 hover:border-blue-300"
            >
              <span className="flex items-center gap-1">
                {chip.key === 'timerange' ? (
                  <>
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                    <span className="font-semibold">{chip.value}</span>
                  </>
                ) : (
                  <>
                    <span className="text-blue-600 font-medium">{chip.key}:</span>
                    <span className="font-semibold text-blue-900">{chip.value}</span>
                  </>
                )}
              </span>
              <button 
                onClick={() => removeFilterChip(chip.key)}
                className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-200 hover:bg-red-200 text-blue-700 hover:text-red-700 transition-all duration-200 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-300"
                title="Remove filter"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination controls */}
      <div className="flex items-center justify-between mb-4 p-3 bg-gradient-to-r from-gray-50 to-slate-50 border border-gray-200 rounded-lg shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Rows per page
          </span>
          <div className="relative" ref={pageSizeDropdownRef}>
            <button 
              onClick={() => setPageSizeDropdownOpen(!pageSizeDropdownOpen)}
              className="inline-flex items-center gap-2 px-4 py-2.5 pr-10 bg-white border border-blue-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <span>{pageSize}</span>
            </button>
            <svg className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-200 ${pageSizeDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            
            {pageSizeDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-full bg-white border border-blue-200 rounded-lg shadow-lg z-50 overflow-hidden">
                {[15, 30, 50, 100, 200].map((size) => (
                  <button
                    key={size}
                    onClick={() => {
                      setPageSize(size);
                      setPage(1);
                      setPageSizeDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm font-medium transition-all duration-150 ${
                      size === pageSize 
                        ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' 
                        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                    }`}
                  >
                    {size}
                    {size === pageSize && (
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
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-600 font-medium bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
            {paginatedAgents.start}-{paginatedAgents.end} of {paginatedAgents.total} items
          </span>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={paginatedAgents.currentPage <= 1}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-300 transition-all duration-200 shadow-sm hover:shadow-md"
              title="Previous page"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-caption text-tertiary px-2">{paginatedAgents.currentPage} / {paginatedAgents.pages}</span>
            <button 
              onClick={() => setPage(p => Math.min(paginatedAgents.pages, p + 1))}
              disabled={paginatedAgents.currentPage >= paginatedAgents.pages}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-300 transition-all duration-200 shadow-sm hover:shadow-md"
              title="Next page"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Agents table */}
      <div className="overflow-auto border border-gray-200 rounded-xl shadow-sm bg-white" style={{ maxHeight: 'calc(15 * var(--row-h, 40px) + 130px)' }}>
        <table className="w-full table-cell-text" style={{ minWidth: '1400px' }}>
          <thead className="sticky top-0 z-10">
            {/* Header row */}
            <tr className="bg-gradient-to-r from-slate-50 to-blue-50 border-b-2 border-blue-200">
              <th 
                className="text-left p-4 cursor-pointer table-header-text table-header-hover group" 
                onClick={() => handleSort('agent_id')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Agent ID</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('agent_id')}</span>
                </div>
              </th>
              <th 
                className="text-left p-4 cursor-pointer table-header-text table-header-hover group" 
                onClick={() => handleSort('url')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">URL</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('url')}</span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a1.994 1.994 0 01-1.414.586H7a4 4 0 01-4-4V7a4 4 0 014-4z" />
                  </svg>
                  <span className="font-semibold text-white">Labels</span>
                </div>
              </th>
              <th 
                className="text-left p-4 cursor-pointer table-header-text table-header-hover group" 
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Status</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('status')}</span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="font-semibold text-white">Availability</span>
                </div>
              </th>
              <th 
                className="text-left p-4 cursor-pointer table-header-text table-header-hover group" 
                onClick={() => handleSort('last_heartbeat')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Last Heartbeat</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('last_heartbeat')}</span>
                </div>
              </th>
              <th 
                className="text-left p-4 cursor-pointer table-header-text table-header-hover group" 
                onClick={() => handleSort('jobs_in_range')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">{formatRangeLabel()}</span> 
                                    <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('jobs_in_range')}
                </span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                  <span className="font-semibold text-white">Actions</span>
                </div>
              </th>
            </tr>

            {/* Filter row */}
            <tr className="bg-gradient-to-r from-blue-25 to-indigo-25 border-b-2 border-blue-100">
              <th className="p-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input 
                    value={filters.agent_id}
                    onChange={(e) => handleFilterChange('agent_id', e.target.value)}
                    className="border border-blue-200 rounded-lg pl-10 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" 
                    placeholder="Filter agent ID" 
                  />
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  <input 
                    value={filters.url}
                    onChange={(e) => handleFilterChange('url', e.target.value)}
                    className="border border-blue-200 rounded-lg pl-10 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" 
                    placeholder="Filter URL" 
                  />
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a1.994 1.994 0 01-1.414.586H7a4 4 0 01-4-4V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <input 
                    value={filters.labels}
                    onChange={(e) => handleFilterChange('labels', e.target.value)}
                    className="border border-blue-200 rounded-lg pl-10 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" 
                    placeholder="key or 'k:v'" 
                  />
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <select 
                    value={filters.status}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    className="border border-blue-200 rounded-lg pl-10 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md appearance-none"
                >
                  <option value=""></option>
                    <option value="">All Status</option>
                    <option>Registered</option>
                    <option>Discovered</option>
                    <option>Offline</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <select 
                    value={filters.availability}
                    onChange={(e) => handleFilterChange('availability', e.target.value)}
                    className="border border-blue-200 rounded-lg pl-10 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md appearance-none"
                  >
                    <option value="">All Availability</option>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </th>
              <th className="p-3"></th>
              <th className="p-3"></th>
              <th className="p-3">
                <button 
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-red-800 bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 rounded-lg hover:from-red-200 hover:to-pink-200 hover:border-red-400 transition-all duration-200 shadow-md hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-red-400 backdrop-blur-sm transform hover:scale-105"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                  Clear all
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {paginatedAgents.agents.length === 0 ? (
              <tr>
                <td className="p-8 text-center" colSpan="8">
                  <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
                    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-600">No agents found</p>
                      <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or check back later</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedAgents.agents.map((agent, idx) => (
                <AgentRow 
                  key={agent.agent_id} 
                  agent={agent} 
                  timezone={timezone}
                  jobCount={jobCounts[agent.agent_id] || 0}
                  getStatus={(agent) => getAgentStatus(agent, OFFLINE_THRESHOLD_MS)}
                  getAvailability={(agent) => getAgentAvailability(agent, OFFLINE_THRESHOLD_MS)}
                  onTestJobClick={onTestJobClick}
                  onDeregisterClick={deregisterAgent}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AgentRow = ({ 
  agent, 
  timezone, 
  jobCount, 
  getStatus, 
  getAvailability, 
  onTestJobClick, 
  onDeregisterClick 
}) => {
  const status = getStatus(agent);
  const availability = getAvailability(agent);
  const canSubmitTestJob = status === 'Registered' && availability === 'Active';

  return (
    <tr className="border-b border-slate-200 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-sm transition-all duration-200 group">
      <td className="p-4 table-cell-mono group-hover:text-slate-900">{agent.agent_id}</td>
      <td className="p-4 table-cell-mono text-blue-600 hover:text-blue-800 group-hover:text-slate-900">{agent.url}</td>
      <td className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(agent.labels || {}).length > 0 ? (
            Object.entries(agent.labels || {}).map(([key, value]) => (
              <span 
                key={key} 
                className="inline-flex items-center px-2 py-1 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-md status-text text-blue-800 shadow-sm"
              >
                <span className="text-blue-600">{key}:</span>
                <span className="ml-1 font-semibold">{value}</span>
              </span>
            ))
          ) : (
            <span className="text-tertiary text-body">-</span>
          )}
        </div>
      </td>
      <td className="p-4">
        <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-semibold shadow-sm ${
          status === 'Registered' ? 'bg-green-100 text-green-800 border border-green-200' :
          status === 'Discovered' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
          'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {status}
        </span>
      </td>
      <td className="p-4">
        <span className="inline-flex items-center gap-2">
          <span 
            className={`inline-block w-3 h-3 rounded-full ${
              availability === 'Active' ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="table-cell-text font-medium">{availability}</span>
        </span>
      </td>
      <td className="p-4 text-secondary">
        <div className="flex flex-col gap-1">
          <span className="text-body font-medium">{fmtDate(agent.last_heartbeat, timezone)}</span>
          <span className="text-body-small text-tertiary">{fmtAgo(agent.last_heartbeat)}</span>
        </div>
      </td>
      <td className="p-4">
        <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
          {jobCount}
        </span>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTestJobClick(agent.agent_id)}
            disabled={!canSubmitTestJob}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              canSubmitTestJob 
                ? 'bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 text-white focus:ring-green-300 cursor-pointer' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed focus:ring-gray-300'
            }`}
            title={canSubmitTestJob ? 'Test A Job' : 'Test Job can only be submitted for Registered & Active agents'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          
          {status === 'Registered' && (
            <button 
              onClick={() => onDeregisterClick(agent.agent_id)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-red-400 to-pink-500 hover:from-red-500 hover:to-pink-600 text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="text-xs font-semibold">Deregister</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

export default AgentsTab;