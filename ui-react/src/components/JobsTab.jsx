import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { fmtDate, fmtAgo, includesAll, matchLabels } from '../utils/api';
import AirflowIcon from './AirflowIcon';
import FlaskIcon from './FlaskIcon';

// Utility function to format execution time duration
const formatExecutionTime = (startedAt, finishedAt, serverExecutionTime) => {
  // Use server-provided execution_time if available
  if (serverExecutionTime && serverExecutionTime !== '-') {
    return serverExecutionTime;
  }
  
  if (!startedAt) return '-';
  
  const start = new Date(startedAt);
  const end = finishedAt ? new Date(finishedAt) : new Date();
  const diffMs = end - start;
  
  // Handle zero or near-zero duration properly
  if (diffMs < 0) return '0s'; // Changed from '-' to '0s' for consistency
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

// Helper function to convert execution time string to seconds
const convertExecutionTimeToSeconds = (timeStr) => {
  if (!timeStr || timeStr === '-') return NaN;
  
  let totalSeconds = 0;
  
  // Match days (e.g., "2d")
  const daysMatch = timeStr.match(/(\d+)d/);
  if (daysMatch) totalSeconds += parseInt(daysMatch[1]) * 24 * 60 * 60;
  
  // Match hours (e.g., "3h")
  const hoursMatch = timeStr.match(/(\d+)h/);
  if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 60 * 60;
  
  // Match minutes (e.g., "45m")
  const minutesMatch = timeStr.match(/(\d+)m/);
  if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;
  
  // Match seconds (e.g., "30s")
  const secondsMatch = timeStr.match(/(\d+)s/);
  if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);
  
  return totalSeconds;
};

const JobsTab = ({ jobs, timezone, timeRange, filterJobsByTime, onJobClick, onTimeRangeClear, loading }) => {
  const [filters, setFilters] = useState({
    job_id: '',
    dag_id: '',
    task_id: '',
    status: '',
    agent_id: '',
    rc: '',
    labels: '',
    execution_time_operator: '',
    execution_time_value: ''
  });
  
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
  const [executionTimeDropdownOpen, setExecutionTimeDropdownOpen] = useState(false);
  const statusDropdownRef = useRef(null);
  const pageSizeDropdownRef = useRef(null);
  const executionTimeDropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setStatusDropdownOpen(false);
      }
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(event.target)) {
        setPageSizeDropdownOpen(false);
      }
      if (executionTimeDropdownRef.current && !executionTimeDropdownRef.current.contains(event.target)) {
        setExecutionTimeDropdownOpen(false);
      }
    };

    if (statusDropdownOpen || pageSizeDropdownOpen || executionTimeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [statusDropdownOpen, pageSizeDropdownOpen, executionTimeDropdownOpen]);

  // Filter and sort jobs
  const filteredJobs = useMemo(() => {
    let filtered = [...jobs];
    
    // Apply column filters
    if (filters.job_id) {
      filtered = filtered.filter(j => includesAll(j.job_id || '', filters.job_id));
    }
    if (filters.dag_id) {
      filtered = filtered.filter(j => includesAll(j.dag_id || '', filters.dag_id));
    }
    if (filters.task_id) {
      filtered = filtered.filter(j => includesAll(j.task_id || '', filters.task_id));
    }
    if (filters.status) {
      filtered = filtered.filter(j => String(j.status || '').toUpperCase() === String(filters.status).toUpperCase());
    }
    if (filters.agent_id) {
      filtered = filtered.filter(j => includesAll(j.agent_id || '', filters.agent_id));
    }
    if (filters.rc !== '') {
      filtered = filtered.filter(j => String(j.rc) === String(filters.rc));
    }
    if (filters.labels) {
      filtered = filtered.filter(j => matchLabels(j.labels, filters.labels));
    }
    if (filters.execution_time_operator && filters.execution_time_value) {
      filtered = filtered.filter(j => {
        const executionTime = formatExecutionTime(j.started_at, j.finished_at, j.execution_time);
        if (executionTime === '-') return false;
        
        // Convert execution time to seconds for comparison
        const timeInSeconds = convertExecutionTimeToSeconds(executionTime);
        const filterValue = parseInt(filters.execution_time_value);
        
        if (isNaN(timeInSeconds) || isNaN(filterValue)) return true;
        
        switch (filters.execution_time_operator) {
          case 'gt': return timeInSeconds > filterValue;
          case 'lt': return timeInSeconds < filterValue;
          case 'eq': return timeInSeconds === filterValue;
          default: return true;
        }
      });
    }
    
    // Apply time range filter
    filtered = filterJobsByTime(filtered);
    
    // Apply sorting
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      if (key.endsWith('_at')) return (new Date(va) - new Date(vb)) * mul;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
    
    return filtered;
  }, [jobs, filters, sort, filterJobsByTime]);

  // Paginate jobs
  const paginatedJobs = useMemo(() => {
    const total = filteredJobs.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, pages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    
    return {
      jobs: filteredJobs.slice(start, end),
      total,
      pages,
      currentPage,
      start: total ? start + 1 : 0,
      end: Math.min(end, total)
    };
  }, [filteredJobs, page, pageSize]);

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

  const handleSort = useCallback((key) => {
    setSort(prev => ({
      key,
      dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc'
    }));
    setPage(1);
  }, []);

  const handleFilterChange = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      job_id: '',
      dag_id: '',
      task_id: '',
      status: '',
      agent_id: '',
      rc: '',
      labels: '',
      execution_time_operator: '',
      execution_time_value: ''
    });
    setPage(1);
  }, []);

  const removeFilterChip = useCallback((chipKey) => {
    if (chipKey === 'timerange') {
      // Clear time range filter
      if (onTimeRangeClear) {
        onTimeRangeClear();
      }
      return;
    }
    handleFilterChange(chipKey, '');
  }, [handleFilterChange, onTimeRangeClear]);

  const getSortIndicator = (key) => {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? '▲' : '▼';
  };

  const statusOptions = [
    { value: '', label: 'All statuses' },
    { value: 'QUEUED', label: 'QUEUED' },
    { value: 'RUNNING', label: 'RUNNING' },
    { value: 'SUCCEEDED', label: 'SUCCEEDED' },
    { value: 'FAILED', label: 'FAILED' }
  ];

  const executionTimeOperators = [
    { value: '', label: 'No filter' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'eq', label: '=' }
  ];

  const handleStatusSelect = (value) => {
    handleFilterChange('status', value);
    setStatusDropdownOpen(false);
  };

  const getStatusLabel = () => {
    const option = statusOptions.find(opt => opt.value === filters.status);
    return option ? option.label : 'All statuses';
  };

  const getExecutionTimeLabel = () => {
    if (!filters.execution_time_operator) return 'No filter';
    const operator = executionTimeOperators.find(op => op.value === filters.execution_time_operator);
    const operatorLabel = operator ? operator.label : 'No filter';
    return filters.execution_time_value ? `${operatorLabel} ${filters.execution_time_value}s` : operatorLabel;
  };

  const handleExecutionTimeOperatorSelect = (operator) => {
    handleFilterChange('execution_time_operator', operator);
    setExecutionTimeDropdownOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">Loading jobs...</div>
      </div>
    );
  }

  return (
    <div>
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
            {paginatedJobs.start}-{paginatedJobs.end} of {paginatedJobs.total} items
          </span>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={paginatedJobs.currentPage <= 1}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-300 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs text-slate-500 px-2">{paginatedJobs.currentPage} / {paginatedJobs.pages}</span>
            <button 
              onClick={() => setPage(p => Math.min(paginatedJobs.pages, p + 1))}
              disabled={paginatedJobs.currentPage >= paginatedJobs.pages}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-300 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Jobs table */}
      <div className="overflow-auto border border-gray-200 rounded-xl shadow-sm bg-white h-full" style={{ maxHeight: 'calc(100vh - 16rem)', minHeight: '400px' }}>
        <table className="w-full table-cell-text" style={{ minWidth: '1400px' }}>
          <thead className="sticky top-0 z-10">
            {/* Header row */}
            <tr className="bg-gradient-to-r from-slate-50 to-blue-50 border-b-2 border-blue-200">
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('job_id')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a1.994 1.994 0 01-1.414.586H7a4 4 0 01-4-4V7a4 4 0 014-4z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Job ID</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('job_id')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('dag_id')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">DAG ID</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('dag_id')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('task_id')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Task ID</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('task_id')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('status')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Status</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('status')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('agent_id')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Agent</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('agent_id')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('execution_time')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Execution Time</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('execution_time')}</span>
                </div>
              </th>
              <th className="text-left p-4 cursor-pointer table-header-text table-header-hover group" onClick={() => handleSort('created_at')}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-white group-hover:text-white transition-colors">Created</span>
                  <span className="text-caption text-blue-600 group-hover:text-blue-200 transition-colors font-bold">{getSortIndicator('created_at')}</span>
                </div>
              </th>
              <th className="text-left p-4 table-header-text">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span className="font-semibold text-white">Actions</span>
                </div>
              </th>
            </tr>

            {/* Filter row */}
            <tr className="bg-gradient-to-r from-blue-25 to-indigo-25 border-b-2 border-blue-100">
              <th className="p-3">
                <div className="relative">
                  <input value={filters.job_id} onChange={(e) => handleFilterChange('job_id', e.target.value)} className="border border-blue-200 rounded-lg pl-3 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" placeholder="Filter job ID" />
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <input value={filters.dag_id || ''} onChange={(e) => handleFilterChange('dag_id', e.target.value)} className="border border-blue-200 rounded-lg pl-3 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" placeholder="Filter DAG ID" />
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <input value={filters.task_id || ''} onChange={(e) => handleFilterChange('task_id', e.target.value)} className="border border-blue-200 rounded-lg pl-3 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" placeholder="Filter Task ID" />
                </div>
              </th>
              <th className="p-3">
                <div className="relative" ref={statusDropdownRef}>
                  <button onClick={() => setStatusDropdownOpen(!statusDropdownOpen)} className="border border-blue-200 rounded-lg pl-3 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-left">{getStatusLabel()}</button>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${statusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {statusDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-gradient-to-r from-blue-25 to-indigo-25 border border-blue-200 rounded-lg shadow-lg z-50 overflow-y-auto backdrop-blur-sm">
                      {statusOptions.map((option) => (
                        <button key={option.value} onClick={() => handleStatusSelect(option.value)} className={`w-full text-left px-4 py-2.5 text-sm transition-all duration-150 hover:bg-blue-100/60 hover:text-blue-900 ${filters.status === option.value ? 'bg-blue-200/70 text-blue-900 font-medium' : 'text-gray-800'}`}>{option.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              </th>
              <th className="p-3">
                <div className="relative">
                  <input value={filters.agent_id} onChange={(e) => handleFilterChange('agent_id', e.target.value)} className="border border-blue-200 rounded-lg pl-3 pr-3 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" placeholder="Filter agent" />
                </div>
              </th>
              <th className="p-3">
                <div className="flex gap-2" ref={executionTimeDropdownRef}>
                  <div className="relative flex-1">
                    <button onClick={() => setExecutionTimeDropdownOpen(!executionTimeDropdownOpen)} className="border border-blue-200 rounded-lg pl-3 pr-10 py-2.5 w-full text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-left">{getExecutionTimeLabel()}</button>
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none z-10">
                      <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${executionTimeDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {executionTimeDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-gradient-to-r from-blue-25 to-indigo-25 border border-blue-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto backdrop-blur-sm">
                        {executionTimeOperators.map((operator) => (
                          <button key={operator.value} onClick={() => handleExecutionTimeOperatorSelect(operator.value)} className={`w-full text-left px-4 py-2.5 text-sm transition-all duration-150 hover:bg-blue-100/60 hover:text-blue-900 ${filters.execution_time_operator === operator.value ? 'bg-blue-200/70 text-blue-900 font-medium' : 'text-gray-800'}`}>{operator.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  {filters.execution_time_operator && (
                    <input type="number" min="0" value={filters.execution_time_value} onChange={(e) => handleFilterChange('execution_time_value', e.target.value)} className="border border-blue-200 rounded-lg px-3 py-2.5 w-20 text-sm text-gray-900 bg-white/80 hover:bg-white focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 transition-all duration-200 placeholder-gray-400 shadow-sm hover:shadow-md" placeholder="sec" />
                  )}
                </div>
              </th>
              <th className="p-3">
                <div className="flex items-center justify-center h-11">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-100 to-indigo-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </th>
              <th className="p-3">
                <button onClick={handleClearFilters} className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-red-700 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-lg hover:from-red-100 hover:to-pink-100 hover:border-red-300 transition-all duration-200 shadow-sm hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-300 backdrop-blur-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                  Clear all
                </button>
              </th>
            </tr>
          </thead>

          <tbody className="h-full">
            {paginatedJobs.jobs.length === 0 ? (
              <tr>
                <td className="p-8 text-center" colSpan="8">
                  <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
                    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-600">No jobs found</p>
                      <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or time range</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedJobs.jobs.map(job => (
                <tr className="border-b border-slate-200 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-sm transition-all duration-200 group" key={job.job_id}>
                  <td className="p-4 table-cell-mono group-hover:text-slate-900">{job.job_id}</td>
                  <td className="p-4 table-cell-mono group-hover:text-slate-900">
                    <div className="flex items-center gap-2">
                      {job.dag_id && job.dag_id !== "-" && job.dag_id !== "Not Applicable" && (
                        <AirflowIcon />
                      )}
                      {job.dag_id === "Not Applicable" && (
                        <FlaskIcon className="w-4 h-4 text-orange-500" />
                      )}
                      <span>{job.dag_id || "-"}</span>
                    </div>
                  </td>
                  <td className="p-4 table-cell-mono group-hover:text-slate-900">{job.task_id || "-"}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-semibold shadow-sm status-chip-${job.status}`}>
                      {job.status === 'SUCCEEDED' && (
                        <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {job.status === 'FAILED' && (
                        <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414z" clipRule="evenodd" />
                        </svg>
                      )}
                      {job.status === 'RUNNING' && (
                        <div className="w-2.5 h-2.5 mr-1.5 rounded-full bg-current animate-pulse"></div>
                      )}
                      {job.status === 'QUEUED' && (
                        <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm1-12a1 1 0 1 0-2 0v4a1 1 0 0 0.293.707l2.828 2.829a1 1 0 1 0 1.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                      )}
                      {job.status === 'PENDING_AGENT_SYNC' && (
                        <svg className="w-3 h-3 mr-1.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                          <circle cx="10" cy="10" r="8" fill="#FDE68A" />
                          <path fillRule="evenodd" d="M10 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0V7a1 1 0 0 1 1-1zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" clipRule="evenodd" fill="#B45309" />
                        </svg>
                      )}
                      <span className="status-text">{job.status}</span>
                    </span>
                  </td>
                  <td className="p-4 table-cell-mono group-hover:text-slate-900">{job.agent_id || "-"}</td>
                  <td className="p-4 text-center">
                    <div className="flex flex-col gap-1">
                      <span className="text-body-large font-medium text-slate-700 group-hover:text-slate-900">
                        {formatExecutionTime(job.started_at, job.finished_at, job.execution_time)}
                      </span>
                      {job.status === 'RUNNING' && job.started_at && (
                        <span className="text-xs text-amber-600 font-medium animate-pulse">Running</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-secondary">
                    <div className="flex flex-col gap-1">
                      <span className="text-body-large font-medium">{fmtDate(job.created_at, timezone)}</span>
                      <span className="text-body text-tertiary">{fmtAgo(job.created_at)}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <button onClick={() => onJobClick(job.job_id)} className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white btn-text-small rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span>View Details</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JobsTab;