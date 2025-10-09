import React, { useState, useEffect, useRef, memo } from 'react';
import { fetchJSON, API_BASE, fmtDate, fmtAgo, getAuthHeaders } from '../utils/api';

// Utility function to format execution time duration
const formatExecutionTime = (startedAt, finishedAt, serverExecutionTime) => {
  // Use server-provided execution_time if available
  if (serverExecutionTime && serverExecutionTime !== '-') {
    return serverExecutionTime;
  }
  
  if (!startedAt) return 'Not started';
  
  const start = new Date(startedAt);
  const end = finishedAt ? new Date(finishedAt) : new Date();
  const diffMs = end - start;
  
  // Handle zero or near-zero duration properly
  if (diffMs < 0) return '0s'; // Changed from 'Invalid time' to '0s'
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

const JobDrawer = memo(({ jobId, jobs, timezone, onClose }) => {
  const [jobDetails, setJobDetails] = useState(null);
  const [logs, setLogs] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);
  const logRef = useRef(null);

  // Find job in the jobs array
  const job = jobs.find(j => j.job_id === jobId);

  // Close dialog when pressing Escape key
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!jobId) return;

    const fetchJobData = async (isInitialLoad = false) => {
      try {
        // Only show loading on initial load, not on refreshes
        if (isInitialLoad) {
          setLoading(true);
        }
        
        const [statusResp, logsResp] = await Promise.all([
          fetchJSON(`${API_BASE}/status/${jobId}`),
          fetch(`${API_BASE}/logs/${jobId}`, { headers: getAuthHeaders() })
        ]);
        
        const logsText = await logsResp.text();
        
        // Only update state if data has actually changed to prevent flickering
        setJobDetails(prevDetails => {
          const newDetails = statusResp;
          // Deep comparison to avoid unnecessary updates
          if (JSON.stringify(prevDetails) !== JSON.stringify(newDetails)) {
            return newDetails;
          }
          return prevDetails;
        });
        
        setLogs(prevLogs => {
          if (prevLogs !== logsText) {
            // Auto-scroll to bottom only when logs actually change
            setTimeout(() => {
              if (logRef.current) {
                logRef.current.scrollTop = logRef.current.scrollHeight;
              }
            }, 0);
            return logsText;
          }
          return prevLogs;
        });
        
      } catch (err) {
        console.error('Failed to fetch job data:', err);
      } finally {
        if (isInitialLoad) {
          setLoading(false);
        }
      }
    };

    // Initial load with loading indicator
    fetchJobData(true);

    // Set up auto-refresh for logs (without loading indicator)
    if (autoFollow) {
      intervalRef.current = setInterval(() => fetchJobData(false), 2000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [jobId, autoFollow]);

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      // Could add visual feedback here
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };


  const handleCopyJobId = async () => {
    try {
      await navigator.clipboard.writeText(jobId);
    } catch (err) {
      console.error('Failed to copy job ID:', err);
    }
  };

  const handleCopyDagId = async () => {
    try {
      await navigator.clipboard.writeText(combinedJob.dag_id || '');
    } catch (err) {
      console.error('Failed to copy DAG ID:', err);
    }
  };

  const handleCopyTaskId = async () => {
    try {
      await navigator.clipboard.writeText(combinedJob.task_id || '');
    } catch (err) {
      console.error('Failed to copy Task ID:', err);
    }
  };

  const handleCopyLogPath = async () => {
    try {
      await navigator.clipboard.writeText(combinedJob.log_path || '');
      // Could add visual feedback here
    } catch (err) {
      console.error('Failed to copy log path:', err);
    }
  };

  // Memoize combined job data to prevent flickering
  const combinedJob = React.useMemo(() => {
    return { ...job, ...jobDetails };
  }, [job, jobDetails]);

  if (!jobId) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[75vh] overflow-hidden border border-gray-100">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-gray-100 mb-4">
            <h3 className="text-heading-1 text-primary flex items-center gap-2">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
              Job {jobId}
            </h3>
            <div className="relative group">
              <button 
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200 flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="absolute right-full top-1/2 transform -translate-y-1/2 mr-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                Close
              </div>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex gap-6 h-[calc(75vh-140px)]">
            {/* Left Column - Job Details */}
            <div className="flex-1 space-y-4 overflow-y-auto">
              {loading ? (
                <div className="text-body-large text-gray-500 p-4 bg-gray-50 rounded-lg border border-gray-200">Loading job details...</div>
              ) : (
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-4">
                  <h4 className="text-heading-2 text-primary flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Job Details
                  </h4>
                  <div className="space-y-3 text-body-large">

                    {/* Job ID */}
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">Job ID:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-mono-large bg-blue-50 px-2 py-1 rounded border font-mono">{jobId}</span>
                        <button
                          onClick={handleCopyJobId}
                          className="inline-flex items-center p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all duration-200"
                          title="Copy Job ID"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* DAG ID */}
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">DAG ID:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-mono-large bg-blue-50 px-2 py-1 rounded border font-mono">{combinedJob.dag_id || '-'}</span>
                        {combinedJob.dag_id && combinedJob.dag_id !== 'Not Applicable' && (
                          <button
                            onClick={handleCopyDagId}
                            className="inline-flex items-center p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all duration-200"
                            title="Copy DAG ID"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Task ID */}
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">Task ID:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-mono-large bg-blue-50 px-2 py-1 rounded border font-mono">{combinedJob.task_id || '-'}</span>
                        {combinedJob.task_id && combinedJob.task_id !== 'Not Applicable' && (
                          <button
                            onClick={handleCopyTaskId}
                            className="inline-flex items-center p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all duration-200"
                            title="Copy Task ID"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">Status:</span>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-body font-semibold shadow-sm ${
                        combinedJob.status === 'PENDING_AGENT_SYNC' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' : 
                        `status-chip-${combinedJob.status}`
                      }`}>
                        {combinedJob.status === 'SUCCEEDED' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {combinedJob.status === 'FAILED' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        )}
                        {combinedJob.status === 'RUNNING' && (
                          <div className="w-2 h-2 mr-1.5 rounded-full bg-current animate-pulse"></div>
                        )}
                        {combinedJob.status === 'PENDING_AGENT_SYNC' && (
                          <div className="w-2 h-2 mr-1.5 rounded-full bg-current animate-pulse"></div>
                        )}
                        {combinedJob.status === 'QUEUED' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm1-12a1 1 0 1 0-2 0v4a1 1 0 0 0.293.707l2.828 2.829a1 1 0 1 0 1.415-1.415L11 9.586V6z" clipRule="evenodd" />
                          </svg>
                        )}
                        {combinedJob.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">Agent:</span>
                      <span className="text-mono-large bg-blue-50 px-2 py-1 rounded border">{combinedJob.agent_id || "-"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="form-label text-body-large font-semibold min-w-[80px]">RC:</span>
                      <span className="text-mono-large bg-gray-100 px-2 py-1 rounded">{combinedJob.rc ?? "-"}</span>
                    </div>
                    <div>
                      <span className="form-label text-body-large font-semibold">Execution Time:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-body-large font-medium text-slate-700">
                          {formatExecutionTime(combinedJob.started_at, combinedJob.finished_at, combinedJob.execution_time)}
                        </span>
                        {combinedJob.status === 'RUNNING' && combinedJob.started_at && (
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-medium animate-pulse">
                            Currently Running
                          </span>
                        )}
                      </div>
                      {combinedJob.started_at && (
                        <div className="text-secondary text-body mt-1">
                          <span>Started: {fmtDate(combinedJob.started_at, timezone)} · {fmtAgo(combinedJob.started_at)}</span>
                          {combinedJob.finished_at && (
                            <span className="block">Finished: {fmtDate(combinedJob.finished_at, timezone)} · {fmtAgo(combinedJob.finished_at)}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="form-label text-body-large font-semibold">Created:</span>
                      <div className="text-secondary text-body-large mt-1">{fmtDate(combinedJob.created_at, timezone)} · {fmtAgo(combinedJob.created_at)}</div>
                    </div>
                    <div>
                      <span className="form-label text-body-large font-semibold">Updated:</span>
                      <div className="text-secondary text-body-large mt-1">{fmtDate(combinedJob.updated_at, timezone)} · {fmtAgo(combinedJob.updated_at)}</div>
                    </div>
                    <div>
                      <span className="form-label text-body-large font-semibold">Labels:</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(combinedJob.labels || {}).map(([k, v]) => (
                          <span 
                            key={k} 
                            className="inline-flex items-center px-2 py-1 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-md text-body text-blue-800 shadow-sm"
                          >
                            <span className="text-blue-600 font-bold">{k.replace(/_/g, '-').toUpperCase()}:</span>
                            <span className="ml-1 font-bold">{v.toUpperCase()}</span>
                          </span>
                        ))}
                        {Object.keys(combinedJob.labels || {}).length === 0 && (
                          <span className="text-tertiary text-body-large italic">No labels</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="form-label text-body-large font-semibold">Log path:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-mono-large bg-gray-100 px-2 py-1 rounded border break-all flex-1 font-mono">{combinedJob.log_path || "-"}</div>
                        {combinedJob.log_path && (
                          <button
                            onClick={handleCopyLogPath}
                            className="inline-flex items-center p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all duration-200 flex-shrink-0"
                            title="Copy Log Path"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Pipeline + Logs */}
            <div className="flex-1 flex flex-col space-y-4">
              {/* Job Execution Pipeline */}
              {combinedJob && (
                <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-xl p-6 shadow-lg">
                  <div className="text-center mb-4">
                    <h3 className="text-sm font-bold text-slate-700 tracking-wide">JOB EXECUTION PIPELINE</h3>
                  </div>
                  <div className="flex items-center justify-center space-x-8">
                    {/* SUBMITTED Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        combinedJob.status === 'SUBMITTED' 
                          ? 'bg-gradient-to-br from-blue-400 to-blue-600 shadow-xl scale-110 animate-pulse' 
                          : ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) 
                            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg' 
                            : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {combinedJob.status === 'SUBMITTED' && (
                          <div className="absolute inset-0 rounded-full bg-blue-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {combinedJob.status === 'SUBMITTED' ? (
                          <div className="relative">
                            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        ) : ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        combinedJob.status === 'SUBMITTED' ? 'text-blue-700' : 
                        ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? 'text-emerald-700' : 'text-slate-600'
                      }`}>
                        SUBMITTED
                      </span>
                      {combinedJob.status === 'SUBMITTED' && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                        </div>
                      )}
                    </div>
                    
                    {/* Arrow 1 */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-12 h-1 bg-slate-300 rounded-full overflow-hidden">
                        {['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) && (
                          <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-700 animate-pulse" style={{width: '100%'}}></div>
                        )}
                      </div>
                      <svg className={`w-4 h-4 mt-1 transition-colors duration-500 ${
                        ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? 'text-emerald-500' : 'text-slate-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* RUNNING Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        combinedJob.status === 'RUNNING' 
                          ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl scale-110 animate-pulse' 
                          : ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) 
                            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg' 
                            : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {combinedJob.status === 'RUNNING' && (
                          <div className="absolute inset-0 rounded-full bg-amber-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {combinedJob.status === 'RUNNING' ? (
                          <div className="relative">
                            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        ) : ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l4.828 4.828a1 1 0 01.293.707V17a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1.586a1 1 0 01.293-.707L16.414 13a1 1 0 01.707-.293H19a1 1 0 001-1V9a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293L12.879 3.879A1 1 0 0012.172 3.586L11 5" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        combinedJob.status === 'RUNNING' ? 'text-amber-700' : 
                        ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? 'text-emerald-700' : 'text-slate-600'
                      }`}>
                        RUNNING
                      </span>
                      {combinedJob.status === 'RUNNING' && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                        </div>
                      )}
                    </div>
                    
                    {/* Arrow 2 */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-12 h-1 bg-slate-300 rounded-full overflow-hidden">
                        {['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) && (
                          <div className={`absolute top-0 left-0 h-full rounded-full transition-all duration-700 animate-pulse ${
                            combinedJob.status === 'SUCCEEDED' ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' :
                            combinedJob.status === 'FAILED' ? 'bg-gradient-to-r from-red-400 to-red-600' :
                            'bg-gradient-to-r from-orange-400 to-orange-600'
                          }`} style={{width: '100%'}}></div>
                        )}
                      </div>
                      <svg className={`w-4 h-4 mt-1 transition-colors duration-500 ${
                        ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) ? 
                          combinedJob.status === 'SUCCEEDED' ? 'text-emerald-500' :
                          combinedJob.status === 'FAILED' ? 'text-red-500' : 'text-orange-500'
                        : 'text-slate-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* COMPLETED Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        combinedJob.status === 'SUCCEEDED' 
                          ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-xl scale-110' 
                        : combinedJob.status === 'FAILED' 
                          ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-xl scale-110' 
                        : combinedJob.status === 'CANCELLED' 
                          ? 'bg-gradient-to-br from-orange-400 to-orange-600 shadow-xl scale-110' 
                          : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {combinedJob.status === 'SUCCEEDED' && (
                          <div className="absolute inset-0 rounded-full bg-emerald-400 opacity-30 animate-ping"></div>
                        )}
                        {combinedJob.status === 'FAILED' && (
                          <div className="absolute inset-0 rounded-full bg-red-400 opacity-30 animate-ping"></div>
                        )}
                        {combinedJob.status === 'CANCELLED' && (
                          <div className="absolute inset-0 rounded-full bg-orange-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {combinedJob.status === 'SUCCEEDED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : combinedJob.status === 'FAILED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : combinedJob.status === 'CANCELLED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        combinedJob.status === 'SUCCEEDED' ? 'text-emerald-700' :
                        combinedJob.status === 'FAILED' ? 'text-red-700' :
                        combinedJob.status === 'CANCELLED' ? 'text-orange-700' : 'text-slate-600'
                      }`}>
                        {combinedJob.status === 'SUCCEEDED' ? 'SUCCEEDED' :
                         combinedJob.status === 'FAILED' ? 'FAILED' :
                         combinedJob.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED'}
                      </span>
                      {['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(combinedJob.status) && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className={`w-2 h-2 rounded-full animate-bounce ${
                            combinedJob.status === 'SUCCEEDED' ? 'bg-emerald-500' :
                            combinedJob.status === 'FAILED' ? 'bg-red-500' : 'bg-orange-500'
                          }`} style={{animationDelay: '0.2s'}}></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Logs Section */}
              <div className="flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-heading-2 text-primary flex items-center gap-2">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Logs
                  </h4>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleCopyLogs}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 text-body-large font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
                      title="Copy logs"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </button>
                    <label className="text-body-large flex items-center gap-2 text-gray-700">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2" 
                        checked={autoFollow}
                        onChange={(e) => setAutoFollow(e.target.checked)}
                      /> 
                      Auto-follow
                    </label>
                  </div>
                </div>
                <pre 
                  ref={logRef}
                  className="flex-1 p-4 rounded-lg border border-gray-200 overflow-auto text-mono whitespace-pre-wrap break-words font-mono bg-gray-900 text-green-400 shadow-inner"
                >
                  {logs || 'No logs available...'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default JobDrawer;