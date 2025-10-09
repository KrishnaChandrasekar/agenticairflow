import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { fmtDate, fmtAgo, includesAll, matchLabels, fetchJSON, API_BASE, toTs, getAuthHeaders } from '../utils/api';

// Helper functions moved outside component to prevent hoisting issues

// New registration flow: use agent.state, heartbeat, and capability
const getAgentStatus = (agent) => agent.state || "NEW";
const getAgentHeartbeatStatus = (agent, OFFLINE_THRESHOLD_MS, serverTimeMs) => {
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = serverTimeMs || Date.now();
  if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
    return "Online";
  }
  return "Offline";
};
const getAgentJobCapability = (agent, OFFLINE_THRESHOLD_MS, serverTimeMs) => {
  const state = agent.state || "NEW";
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = serverTimeMs || Date.now();
  const isOnline = lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS);
  if (state === "REGISTERED" && isOnline) {
    return "Available";
  } else if (state === "REGISTERED" && !isOnline) {
    return "Busy";
  } else {
    return "Busy";
  }
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
  const [serverTimeMs, setServerTimeMs] = useState(Date.now());
  const [filters, setFilters] = useState({
    agent_id: '',
    url: '',
    labels: '',
    state: '',
    heartbeat: '',
    capability: ''
  });
  
  const [sort, setSort] = useState({ key: 'agent_id', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  const [heartbeatDropdownOpen, setHeartbeatDropdownOpen] = useState(false);
  const [capabilityDropdownOpen, setCapabilityDropdownOpen] = useState(false);
  const [banner, setBanner] = useState({ show: false, message: '', type: 'info' });
  const [jobCounts, setJobCounts] = useState({});

  // Calculate job counts for each agent based on jobs and timeRange
  useEffect(() => {
    if (!agents || !jobs) return;
    // Filter jobs by time range if filterJobsByTime is provided
    const filteredJobs = typeof filterJobsByTime === 'function' ? filterJobsByTime(jobs) : jobs;
    const counts = {};
    agents.forEach(agent => {
      counts[agent.agent_id] = filteredJobs.filter(job => job.agent_id === agent.agent_id).length;
    });
    setJobCounts(counts);
  }, [agents, jobs, timeRange, filterJobsByTime]);
  const pageSizeDropdownRef = useRef(null);
  const stateDropdownRef = useRef(null);
  const heartbeatDropdownRef = useRef(null);
  const capabilityDropdownRef = useRef(null);

  const OFFLINE_THRESHOLD_MS = 20 * 1000;

  // Fetch server time on mount and every 30s
  useEffect(() => {
    const fetchServerTime = async () => {
      try {
        const resp = await fetch(`${API_BASE}/agents`, { headers: getAuthHeaders() });
        const dateHeader = resp.headers.get('Date');
        let serverNow = null;
        if (dateHeader) {
          serverNow = new Date(dateHeader).getTime();
        } else {
          const data = await resp.json();
          if (Array.isArray(data.agents) && data.agents.length > 0) {
            serverNow = Math.max(...data.agents.map(a => toTs(a.last_heartbeat)));
          } else {
            serverNow = Date.now();
          }
        }
        setServerTimeMs(serverNow);
      } catch (e) {
        setServerTimeMs(Date.now());
      }
    };
    fetchServerTime();
    const interval = setInterval(fetchServerTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(event.target)) {
        setPageSizeDropdownOpen(false);
      }
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target)) {
        setStateDropdownOpen(false);
      }
      if (heartbeatDropdownRef.current && !heartbeatDropdownRef.current.contains(event.target)) {
        setHeartbeatDropdownOpen(false);
      }
      if (capabilityDropdownRef.current && !capabilityDropdownRef.current.contains(event.target)) {
        setCapabilityDropdownOpen(false);
      }
    };

    if (pageSizeDropdownOpen || stateDropdownOpen || heartbeatDropdownOpen || capabilityDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [pageSizeDropdownOpen, stateDropdownOpen, heartbeatDropdownOpen, capabilityDropdownOpen]);

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
    if (filters.state) {
      filtered = filtered.filter(a => {
        const state = getAgentStatus(a);
        return state === filters.state;
      });
    }
    if (filters.heartbeat) {
      filtered = filtered.filter(a => {
        const heartbeat = getAgentHeartbeatStatus(a, OFFLINE_THRESHOLD_MS, serverTimeMs);
        return heartbeat === filters.heartbeat;
      });
    }
    if (filters.capability) {
      filtered = filtered.filter(a => {
        const capability = getAgentJobCapability(a, OFFLINE_THRESHOLD_MS, serverTimeMs);
        return capability === filters.capability;
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
      state: '',
      heartbeat: '',
      capability: ''
    });
    setPage(1);
  };

  // Status dropdown options
    const stateOptions = [
  { value: '', label: 'ALL STATES' },
  { value: 'NEW', label: 'NEW' },
  { value: 'PENDING_APPROVAL', label: 'PENDING APPROVAL' },
  { value: 'ENROLLING', label: 'ENROLLING' },
  { value: 'REGISTERED', label: 'REGISTERED' }
    ];

    const heartbeatOptions = [
      { value: '', label: 'All Heartbeat' },
      { value: 'Online', label: 'Online' },
      { value: 'Offline', label: 'Offline' }
    ];

    const capabilityOptions = [
      { value: '', label: 'All' },
      { value: 'Available', label: 'Available' },
      { value: 'Busy', label: 'Busy' }
    ];

  // ...existing code...

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
      <div className="overflow-auto border border-gray-200 rounded-xl shadow-sm bg-white h-full" style={{ maxHeight: 'calc(100vh - 16rem)', minHeight: '400px' }}>
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
                onClick={() => handleSort('state')}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">State</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('state')}</span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  <span className="font-semibold text-white">Heartbeat</span>
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
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('jobs_in_range')}</span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">Actions</th>
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
                    className="border border-blue-200 rounded-lg pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md text-left" 
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
                    className="border border-blue-200 rounded-lg pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md text-left" 
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
                    className="border border-blue-200 rounded-lg pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md text-left" 
                    placeholder="key or 'k:v'" 
                  />
                </div>
              </th>
              <th className="p-3">
                <div className="relative" ref={stateDropdownRef}>
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <button
                    onClick={() => setStateDropdownOpen(!stateDropdownOpen)}
                    className="border border-blue-200 rounded-lg pl-10 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-left"
                  >
                    {stateOptions.find(o => o.value === filters.state)?.label || 'All States'}
                  </button>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${stateDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {stateDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-blue-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                      {stateOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { handleFilterChange('state', option.value); setStateDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-all duration-150 hover:bg-blue-50 hover:text-blue-900 ${
                            filters.state === option.value 
                              ? 'bg-blue-100 text-blue-900 font-medium' 
                              : 'text-gray-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </th>
              <th className="p-3">
                <div className="relative" ref={heartbeatDropdownRef}>
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <button
                    onClick={() => setHeartbeatDropdownOpen(!heartbeatDropdownOpen)}
                    className="border border-blue-200 rounded-lg pl-10 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-left"
                  >
                    {heartbeatOptions.find(o => o.value === filters.heartbeat)?.label || 'All Heartbeat'}
                  </button>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${heartbeatDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {heartbeatDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-blue-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                      {heartbeatOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { handleFilterChange('heartbeat', option.value); setHeartbeatDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-all duration-150 hover:bg-blue-50 hover:text-blue-900 ${
                            filters.heartbeat === option.value 
                              ? 'bg-blue-100 text-blue-900 font-medium' 
                              : 'text-gray-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </th>
              <th className="p-3">
                <div className="relative" ref={capabilityDropdownRef}>
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a1.994 1.994 0 01-1.414.586H7a4 4 0 01-4-4V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <button
                    onClick={() => setCapabilityDropdownOpen(!capabilityDropdownOpen)}
                    className="border border-blue-200 rounded-lg pl-10 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 backdrop-blur-sm hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-left"
                  >
                    {capabilityOptions.find(o => o.value === filters.capability)?.label || 'All'}
                  </button>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${capabilityDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {capabilityDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-blue-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                      {capabilityOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { handleFilterChange('capability', option.value); setCapabilityDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-all duration-150 hover:bg-blue-50 hover:text-blue-900 ${
                            filters.capability === option.value 
                              ? 'bg-blue-100 text-blue-900 font-medium' 
                              : 'text-gray-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </th>
              <th className="p-3">
                {/* Last Heartbeat filter not needed, but keep cell for alignment */}
              </th>
              <th className="p-3">
                {/* Jobs in Range filter not needed, but keep cell for alignment */}
              </th>
              <th className="p-3">
                <button 
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-red-800 bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 rounded-lg hover:from-red-200 hover:to-pink-200 hover:border-red-400 transition-all duration-200 shadow-md hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-red-400 backdrop-blur-sm transform hover:scale-105"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                  Clear Filters
                </button>
              </th>
            </tr>
          </thead>

          <tbody className="h-full">
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
                  getAgentStatus={(a) => getAgentStatus(a)}
                  getAgentHeartbeatStatus={(a) => getAgentHeartbeatStatus(a, OFFLINE_THRESHOLD_MS, serverTimeMs)}
                  getAgentJobCapability={(a) => getAgentJobCapability(a, OFFLINE_THRESHOLD_MS, serverTimeMs)}
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
  getAgentStatus, 
  getAgentHeartbeatStatus, 
  getAgentJobCapability, 
  onTestJobClick, 
  onDeregisterClick 
}) => {
  const state = getAgentStatus(agent);
  const heartbeatStatus = getAgentHeartbeatStatus(agent);
  const jobCapability = getAgentJobCapability(agent);
  const canSubmitTestJob = state === 'REGISTERED' && jobCapability === 'Available';
  const canDeregister = state === 'REGISTERED';

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
          state === 'REGISTERED' ? 'bg-green-100 text-green-800 border border-green-200' :
          state === 'PENDING_APPROVAL' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
          state === 'ENROLLING' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
          state === 'NEW' ? 'bg-gray-100 text-gray-800 border border-gray-200' :
          'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {state}
        </span>
      </td>
      <td className="p-4">
        <span className="inline-flex items-center gap-2">
          <span 
            className={`inline-block w-3 h-3 rounded-full ${
              heartbeatStatus === 'Online' ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="table-cell-text font-medium">{heartbeatStatus}</span>
        </span>
      </td>
      <td className="p-4">
        <span className="inline-flex items-center gap-2">
          <span 
            className={`inline-block w-3 h-3 rounded-full ${
              jobCapability === 'Available' ? 'bg-green-500' : 'bg-orange-500'
            }`}
          />
          <span className="table-cell-text font-medium">{jobCapability}</span>
        </span>
      </td>
      <td className="p-4 text-secondary">
        <div className="flex flex-col gap-1">
          <span className="text-body-large font-medium">{fmtDate(agent.last_heartbeat, timezone)}</span>
          <span className="text-body text-tertiary">{fmtAgo(agent.last_heartbeat)}</span>
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
            title={canSubmitTestJob ? 'Test A Job' : 'Only for Registered agents'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          {/* Always show Deregister button, disable unless REGISTERED */}
          <button 
            onClick={() => canDeregister && onDeregisterClick(agent.agent_id)}
            disabled={!canDeregister}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              canDeregister
                ? 'bg-gradient-to-r from-red-400 to-pink-500 hover:from-red-500 hover:to-pink-600 text-white focus:ring-red-300 cursor-pointer'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed focus:ring-gray-300'
            }`}
            title={canDeregister ? 'Deregister agent' : 'Can only deregister Registered agents'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
            </svg>
            <span className="text-xs font-semibold">Deregister</span>
          </button>
        </div>
      </td>
    </tr>
  );
};

export default AgentsTab;