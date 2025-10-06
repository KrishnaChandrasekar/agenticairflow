import { useState, useEffect, useRef } from 'react';
import { fetchJSON, API_BASE, fmtDate, fmtAgo, getAuthHeaders } from '../utils/api';

const JobDrawer = ({ jobId, jobs, timezone, onClose }) => {
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

    const fetchJobData = async () => {
      try {
        setLoading(true);
        const [statusResp, logsResp] = await Promise.all([
          fetchJSON(`${API_BASE}/status/${jobId}`),
          fetch(`${API_BASE}/logs/${jobId}`, { headers: getAuthHeaders() })
        ]);
        
        const logsText = await logsResp.text();
        
        setJobDetails(statusResp);
        setLogs(logsText);
        
        // Auto-scroll to bottom
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      } catch (err) {
        console.error('Failed to fetch job data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchJobData();

    // Set up auto-refresh for logs
    if (autoFollow) {
      intervalRef.current = setInterval(fetchJobData, 2000);
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

  const combinedJob = { ...job, ...jobDetails };

  if (!jobId) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden border border-gray-100">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-gray-100">
            <h3 className="text-heading-2 text-primary flex items-center gap-2">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
              Job {jobId}
            </h3>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200 flex items-center justify-center"
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Job metadata */}
          {loading ? (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg border border-gray-200">Loading job details...</div>
          ) : (
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="form-label">Status:</span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold shadow-sm status-chip-${combinedJob.status}`}>
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
                      {combinedJob.status === 'QUEUED' && (
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm1-12a1 1 0 1 0-2 0v4a1 1 0 0 0.293.707l2.828 2.829a1 1 0 1 0 1.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                      )}
                      {combinedJob.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="form-label">Agent:</span>
                    <span className="text-mono bg-blue-50 px-2 py-1 rounded border">{combinedJob.agent_id || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="form-label">RC:</span>
                    <span className="text-mono bg-gray-100 px-2 py-1 rounded">{combinedJob.rc ?? "-"}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <span className="form-label">Created:</span>
                    <div className="text-secondary text-body-small mt-1">{fmtDate(combinedJob.created_at, timezone)} · {fmtAgo(combinedJob.created_at)}</div>
                  </div>
                  <div>
                    <span className="form-label">Updated:</span>
                    <div className="text-secondary text-body-small mt-1">{fmtDate(combinedJob.updated_at, timezone)} · {fmtAgo(combinedJob.updated_at)}</div>
                  </div>
                </div>
              </div>
              <div className="col-span-1 md:col-span-2">
                <div className="space-y-2">
                  <div>
                    <span className="form-label">Labels:</span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {Object.entries(combinedJob.labels || {}).map(([k, v]) => (
                        <span 
                          key={k} 
                          className="inline-flex items-center px-2 py-1 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-md status-text text-emerald-800 shadow-sm"
                        >
                          <span className="text-emerald-600">{k}:</span>
                          <span className="ml-1 font-semibold">{v}</span>
                        </span>
                      ))}
                      {Object.keys(combinedJob.labels || {}).length === 0 && (
                        <span className="text-tertiary text-body italic">No labels</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="form-label">Log path:</span>
                    <div className="text-mono bg-gray-100 px-2 py-1 rounded border mt-1 break-all">{combinedJob.log_path || "-"}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Logs section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-heading-3 text-primary flex items-center gap-2">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Logs
              </h4>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleCopyLogs}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 btn-text rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
                  title="Copy logs"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
                <label className="text-sm flex items-center gap-2 text-gray-700">
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
              className="p-4 rounded-lg border border-gray-200 overflow-auto h-64 text-xs whitespace-pre-wrap break-words font-mono bg-gray-900 text-green-400 shadow-inner"
            >
              {logs || 'No logs available...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobDrawer;