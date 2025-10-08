import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchJSON, toTs, API_BASE } from '../utils/api';

// Hook for timezone management - replicating original UI behavior
export const useTimezone = () => {
  console.log('🚀 TIMEZONE HOOK CALLED!');
  
  // Replicate detectBrowserTZ function from original UI
  const detectBrowserTZ = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return null;
      // Alias reconciliation (same as original UI)
      const alias = {
        "Asia/Kolkata": "Asia/Kolkata",
        "Asia/Calcutta": "Asia/Kolkata"
      };
      return alias[tz] || tz;
    } catch (e) { 
      return null; 
    }
  };
  
  // ALWAYS start with local timezone on fresh page loads (ignore stored preferences)
  const [timezone, setTimezone] = useState(() => {
    console.log('🔍 FRESH PAGE LOAD - TIMEZONE INITIALIZATION:');
    
    const detected = detectBrowserTZ();
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Always use local timezone on page load (ignore localStorage)
    const initialTZ = detected || fallback;
    
    console.log('  - Browser detected:', detected);
    console.log('  - Fallback:', fallback);
    console.log('  - Always using LOCAL timezone:', initialTZ);
    
    // Clear any old stored timezone to prevent interference
    localStorage.removeItem("router_ui_tz");
    // Set fresh local timezone
    localStorage.setItem("router_ui_tz", initialTZ);
    
    console.log('  ✅ Fresh start with local timezone on every page load');
    
    return initialTZ;
  });

  const updateTimezone = useCallback((tz) => {
    console.log('🎯 USER CHANGING timezone from', timezone, 'to', tz);
    
    setTimezone(tz);
    localStorage.setItem("router_ui_tz", tz);
    window.TZ = tz;
    
    console.log('✅ Timezone changed to:', tz);
    console.log('� NOTE: This change is only for current page session');
    console.log('🔄 Next page refresh will reset to local timezone');
  }, [timezone]);

  const resetToLocal = useCallback(() => {
    console.log('🏠 Resetting to local timezone');
    const localTZ = detectBrowserTZ() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    window.TZ = localTZ;
    console.log('✅ Reset to:', localTZ);
    return localTZ;
  }, []);

  const clearTimezoneCache = useCallback(() => {
    console.log('🗑️ CLEARING timezone cache');
    localStorage.removeItem("router_ui_tz");
    const localTZ = detectBrowserTZ() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(localTZ);
    window.TZ = localTZ;
    console.log('✅ Cache cleared, using local:', localTZ);
    console.log('📝 Next page load will start fresh with local timezone');
    return localTZ;
  }, []);

  return { timezone, updateTimezone, resetToLocal, clearTimezoneCache };
};

// Hook for fetching and managing jobs data
export const useJobs = (autoRefresh = true, refreshInterval = 2000) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const statusRefreshRef = useRef(null);

  // Helper function to get individual job status (more accurate than /jobs endpoint)
  const fetchJobStatus = useCallback(async (jobId) => {
    try {
      return await fetchJSON(`${API_BASE}/status/${jobId}`);
    } catch (err) {
      console.warn(`Failed to fetch status for job ${jobId}:`, err);
      return null;
    }
  }, []);

  // Enhanced job processing that checks for stale statuses
  const refreshStaleJobStatuses = useCallback(async (jobsList) => {
    const now = Date.now();
    const staleThreshold = 10000; // 10 seconds
    
    // Find jobs that might have stale status (RUNNING jobs older than threshold)
    const potentiallyStaleJobs = jobsList.filter(job => {
      if (job.status !== 'RUNNING') return false;
      
      const updatedTime = new Date(job.updated_at).getTime();
      return now - updatedTime > staleThreshold;
    });

    if (potentiallyStaleJobs.length === 0) return jobsList;

    console.log(`🔄 Refreshing status for ${potentiallyStaleJobs.length} potentially stale jobs`);

    // Fetch fresh status for potentially stale jobs
    const statusPromises = potentiallyStaleJobs.map(job => 
      fetchJobStatus(job.job_id).then(status => ({ job, status }))
    );

    try {
      const statusResults = await Promise.all(statusPromises);
      
      // Create updated jobs list with fresh status
      const updatedJobs = jobsList.map(job => {
        const statusResult = statusResults.find(r => r.job.job_id === job.job_id);
        
        if (statusResult && statusResult.status) {
          const freshStatus = statusResult.status;
          console.log(`✅ Updated job ${job.job_id}: ${job.status} → ${freshStatus.status}`);
          
          return {
            ...job,
            status: (freshStatus.status || "").toUpperCase(),
            rc: freshStatus.rc !== undefined ? freshStatus.rc : job.rc,
            updated_at: freshStatus.updated_at || job.updated_at,
            started_at: freshStatus.started_at || job.started_at,
            finished_at: freshStatus.finished_at || job.finished_at,
            execution_time: freshStatus.execution_time || job.execution_time,
          };
        }
        
        return job;
      });

      return updatedJobs;
    } catch (err) {
      console.warn('Failed to refresh some job statuses:', err);
      return jobsList;
    }
  }, [fetchJobStatus]);

  const fetchJobsData = useCallback(async (withStatusRefresh = false) => {
    try {
      const j = await fetchJSON(`${API_BASE}/jobs?limit=1000`);
      const arr = Array.isArray(j) ? j : (j.jobs || []);
      
      // Get test job IDs from localStorage
      let testJobIds = [];
      try { 
        testJobIds = JSON.parse(localStorage.getItem("testJobIds") || "[]"); 
      } catch {}
      
      let processedJobs = arr.map(x => {
        const job_id = x.job_id || x.id || "";
        let labels = x.labels || {};
        // If job_id matches a test job, force label
        if (testJobIds.includes(job_id)) {
          labels = { ...labels, "job-type": "test" };
        }
        return {
          job_id,
          status: (x.status || "").toUpperCase(),
          agent_id: x.agent_id || "",
          rc: (x.rc !== undefined ? x.rc : null),
          log_path: x.log_path || "",
          dag_id: x.dag_id || "",
          task_id: x.task_id || "",
          created_at: x.created_at || x.createdAt || null,
          updated_at: x.updated_at || x.updatedAt || null,
          started_at: x.started_at || null,
          finished_at: x.finished_at || null,
          execution_time: x.execution_time || null,
          labels,
        };
      });

      // Optionally refresh stale job statuses for better accuracy
      if (withStatusRefresh) {
        processedJobs = await refreshStaleJobStatuses(processedJobs);
      }
      
      setJobs(processedJobs);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [refreshStaleJobStatuses]);

  useEffect(() => {
    fetchJobsData(true); // Initial fetch with status refresh
    
    if (autoRefresh) {
      let refreshCount = 0;
      
      timerRef.current = setInterval(() => {
        refreshCount++;
        // Every 3rd refresh (6 seconds), do a status refresh for accuracy
        const shouldRefreshStatus = refreshCount % 3 === 0;
        fetchJobsData(shouldRefreshStatus);
      }, refreshInterval);
      
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefresh, refreshInterval, fetchJobsData]);

  const refreshJobs = useCallback(() => {
    setLoading(true);
    fetchJobsData(true); // Always refresh status when manually triggered
  }, [fetchJobsData]);

  return { jobs, loading, error, refreshJobs };
};

// Hook for fetching and managing agents data  
export const useAgents = (autoRefresh = true, refreshInterval = 2000) => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchAgentsData = useCallback(async () => {
    try {
      const j = await fetchJSON(`${API_BASE}/agents`);
      const agentsData = Array.isArray(j) ? j : (j.agents || []);
      setAgents(agentsData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentsData();
    
    if (autoRefresh) {
      timerRef.current = setInterval(fetchAgentsData, refreshInterval);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefresh, refreshInterval, fetchAgentsData]);

  const refreshAgents = useCallback(() => {
    setLoading(true);
    fetchAgentsData();
  }, [fetchAgentsData]);

  return { agents, loading, error, refreshAgents };
};

// Hook for time range filtering
export const useTimeRange = () => {
  const [timeRange, setTimeRange] = useState({
    enabled: false,
    field: 'updated_at',
    mode: 'relative',
    relMins: 1440,
    abs: { fromMs: null, toMs: null },
  });

  const updateTimeRange = useCallback((updates) => {
    setTimeRange(prev => ({ ...prev, ...updates }));
  }, []);

  const filterJobsByTime = useCallback((jobs) => {
    if (!timeRange.enabled) return jobs;
    
    let from = null, to = null;
    if (timeRange.mode === 'relative') {
      to = Date.now();
      from = to - timeRange.relMins * 60 * 1000;
    } else {
      from = timeRange.abs?.fromMs ?? null;
      to = timeRange.abs?.toMs ?? null;
    }
    
    const field = timeRange.field || 'updated_at';
    
    return jobs.filter(job => {
      const v = job[field];
      const t = window.toTs ? window.toTs(v) : Date.parse(v);
      if (!Number.isFinite(t)) return false;
      if (from != null && t < from) return false;
      if (to != null && t > to) return false;
      return true;
    });
  }, [timeRange]);

  return { timeRange, updateTimeRange, filterJobsByTime };
};

// Ensure toTs is available globally for time filtering
if (typeof window !== 'undefined') {
  window.toTs = toTs;
}