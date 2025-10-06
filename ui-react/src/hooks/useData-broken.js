import { useEffect, useState,    // Always use local timezone on page load
    console.log('🆕 PAGE LOAD: Using local timezone:', localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    return localTZ;
  });
  
  // Track if user has manually selected timezone on this page
  const [userHasSelectedOnThisPage, setUserHasSelectedOnThisPage] = useState(false);, useRef } from 'react';
import { fetchJSON, toTs, API_BASE } from '../utils/api';

// Hook for timezone management
export const useTimezone = () => {
  console.log('🚀 TIMEZONE HOOK CALLED!');
  
  const [timezone, setTimezone] = useState(() => {
    console.log('🚀 useState initializer running...');
    
    // Check if user has made any timezone selection in THIS session
    const hasUserSelectionThisSession = sessionStorage.getItem('user_selected_timezone_this_session');
    console.log('🔍 User selection this session:', hasUserSelectionThisSession);
    
    // Detect local timezone
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('🌍 Raw detected:', detected);
    
    // Convert Asia/Calcutta to Asia/Kolkata for India
    const localTZ = detected === 'Asia/Calcutta' ? 'Asia/Kolkata' : detected;
    console.log('✅ Final local timezone:', localTZ);
    
    // If user hasn't selected anything in this session, always use local timezone
    if (!hasUserSelectionThisSession) {
      console.log('🆕 NEW SESSION: Using local timezone:', localTZ);
      localStorage.setItem("router_ui_tz", localTZ);
      return localTZ;
    }
    
    // If user has selected in this session, use their stored preference
    const storedTZ = localStorage.getItem("router_ui_tz");
    if (storedTZ) {
      console.log('� CONTINUING SESSION: Using stored preference:', storedTZ);
      return storedTZ;
    }
    
    // Fallback to local timezone
    console.log('🔄 FALLBACK: Using local timezone:', localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    return localTZ;
  });

  const updateTimezone = useCallback((tz) => {
    console.log('🎯 updateTimezone called with:', tz);
    setTimezone(tz);
    localStorage.setItem("router_ui_tz", tz);
    // Mark that user has made a selection in this session
    sessionStorage.setItem('user_selected_timezone_this_session', 'true');
    console.log('✅ Updated timezone to:', tz);
    console.log('🏷️ Marked as user selection for this session');
  }, []);

  const resetToLocal = useCallback(() => {
    console.log('🏠 resetToLocal called');
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localTZ = detected === 'Asia/Calcutta' ? 'Asia/Kolkata' : detected;
    setTimezone(localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    // Clear session flag so next session will default to local again
    sessionStorage.removeItem('user_selected_timezone_this_session');
    console.log('✅ Reset to:', localTZ);
    console.log('🆕 Cleared session flag - next session will default to local');
    return localTZ;
  }, []);

  const clearTimezoneCache = useCallback(() => {
    console.log('🗑️ clearTimezoneCache called');
    localStorage.removeItem("router_ui_tz");
    sessionStorage.removeItem('user_selected_timezone_this_session');
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localTZ = detected === 'Asia/Calcutta' ? 'Asia/Kolkata' : detected;
    setTimezone(localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    console.log('✅ Cleared cache and reset to:', localTZ);
    console.log('🆕 Cleared session flag - fresh start');
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

  const fetchJobsData = useCallback(async () => {
    try {
      const j = await fetchJSON(`${API_BASE}/jobs?limit=1000`);
      const arr = Array.isArray(j) ? j : (j.jobs || []);
      
      // Get test job IDs from localStorage
      let testJobIds = [];
      try { 
        testJobIds = JSON.parse(localStorage.getItem("testJobIds") || "[]"); 
      } catch {}
      
      const processedJobs = arr.map(x => {
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
          created_at: x.created_at || x.createdAt || null,
          updated_at: x.updated_at || x.updatedAt || null,
          labels,
        };
      });
      
      setJobs(processedJobs);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobsData();
    
    if (autoRefresh) {
      timerRef.current = setInterval(fetchJobsData, refreshInterval);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefresh, refreshInterval, fetchJobsData]);

  const refreshJobs = useCallback(() => {
    setLoading(true);
    fetchJobsData();
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