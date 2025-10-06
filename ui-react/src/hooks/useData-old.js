import { useEffect, useState, useCallback } from 'react';
import { fetchJobs, fetchAgents, detectBrowserTZ } from '../utils/api';

// Ensure toTs is available globally for time filtering
if (typeof window !== 'undefined') {
  window.toTs = toTs;
}

// Hook for fetching and managing jobs data
export const useJobs = (autoRefresh = true, refreshInterval = 2000) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchJobs = useCallback(async () => {
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
    fetchJobs();
    
    if (autoRefresh) {
      timerRef.current = setInterval(fetchJobs, refreshInterval);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefresh, refreshInterval, fetchJobs]);

  const refreshJobs = useCallback(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  return { jobs, loading, error, refreshJobs };
};

// Hook for fetching and managing agents data
export const useAgents = (autoRefresh = true, refreshInterval = 2000) => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchAgents = useCallback(async () => {
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
    fetchAgents();
    
    if (autoRefresh) {
      timerRef.current = setInterval(fetchAgents, refreshInterval);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefresh, refreshInterval, fetchAgents]);

  const refreshAgents = useCallback(() => {
    setLoading(true);
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, refreshAgents };
};

// Hook for timezone management
export const useTimezone = () => {
  const [timezone, setTimezone] = useState(() => {
    // Check if user explicitly set a timezone in this session (not just page load)
    const userSetFlag = sessionStorage.getItem("user_set_timezone");
    
    // Detect local timezone first (with proper India alias handling)
    let detectedTZ = null;
    try {
      detectedTZ = detectBrowserTZ();
      console.log('🌍 Detected local timezone:', detectedTZ);
      
      // Also log the raw detection for debugging
      const rawTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (rawTZ !== detectedTZ) {
        console.log('🔄 Raw timezone converted:', rawTZ, '→', detectedTZ);
      }
    } catch (error) {
      console.warn('⚠️ Failed to detect local timezone:', error);
    }
    
    // Check localStorage
    const stored = localStorage.getItem("router_ui_tz");
    
    // If user hasn't explicitly set timezone in this session, always use local
    if (!userSetFlag && detectedTZ) {
      console.log(`🏠 Auto-setting to local timezone: ${detectedTZ} (no user override in session)`);
      localStorage.setItem("router_ui_tz", detectedTZ);
      return detectedTZ;
    }
    
    // If user set timezone in this session, respect their choice
    if (userSetFlag && stored) {
      console.log(`� Using user-selected timezone: ${stored} (user choice in session)`);
      return stored;
    }
    
    // Default: use detected timezone
    if (detectedTZ) {
      console.log(`🔄 Default to local timezone: ${detectedTZ}`);
      localStorage.setItem("router_ui_tz", detectedTZ);
      return detectedTZ;
    }
    
    // Final fallback
    const fallback = "UTC";
    console.log(`🔄 Final fallback to UTC`);
    localStorage.setItem("router_ui_tz", fallback);
    return fallback;
  });

  const updateTimezone = useCallback((tz) => {
    console.log(`🎯 BEFORE UPDATE: Current timezone state:`, timezone);
    console.log(`👤 USER ACTION: Manually selecting timezone: ${tz}`);
    
    setTimezone(tz);
    localStorage.setItem("router_ui_tz", tz);
    sessionStorage.setItem("user_set_timezone", "true");
    
    console.log(`✅ AFTER UPDATE: Set timezone to: ${tz}`);
    console.log(`💾 AFTER UPDATE: Stored in localStorage: ${localStorage.getItem("router_ui_tz")}`);
    console.log(`🏷️ AFTER UPDATE: Session flag set: ${sessionStorage.getItem("user_set_timezone")}`);
    
    // Force a small delay and log again to see if state updated
    setTimeout(() => {
      console.log(`⏰ DELAYED CHECK: Timezone state after 100ms:`, tz);
    }, 100);
  }, [timezone]);

  const resetToLocal = useCallback(() => {
    try {
      const localTZ = detectBrowserTZ();
      if (localTZ) {
        console.log(`🏠 Reset to local timezone: ${localTZ}`);
        setTimezone(localTZ);
        localStorage.setItem("router_ui_tz", localTZ);
        // Clear user preference to allow auto-detection on next reload
        sessionStorage.removeItem("user_set_timezone");
        return localTZ;
      }
    } catch (error) {
      console.warn('⚠️ Failed to reset to local timezone:', error);
    }
    return null;
  }, []);

  const clearTimezoneCache = useCallback(() => {
    console.log('🗑️ Clearing timezone cache and user preferences, forcing fresh detection...');
    localStorage.removeItem("router_ui_tz");
    sessionStorage.removeItem("user_set_timezone");
    
    // Force fresh detection
    try {
      const localTZ = detectBrowserTZ();
      if (localTZ) {
        console.log(`✅ Fresh detection result: ${localTZ}`);
        setTimezone(localTZ);
        localStorage.setItem("router_ui_tz", localTZ);
        return localTZ;
      }
    } catch (error) {
      console.warn('⚠️ Fresh detection failed:', error);
    }
    return null;
  }, []);

  // Ensure timezone is set to local on mount (extra safety for India users)
  useEffect(() => {
    const checkAndSetLocal = () => {
      try {
        const detectedTZ = detectBrowserTZ();
        const currentStored = localStorage.getItem("router_ui_tz");
        
        if (detectedTZ && currentStored !== detectedTZ) {
          console.log('🔄 Post-mount timezone correction:', currentStored, '→', detectedTZ);
          setTimezone(detectedTZ);
          localStorage.setItem("router_ui_tz", detectedTZ);
        }
      } catch (error) {
        console.warn('⚠️ Post-mount timezone check failed:', error);
      }
    };
    
    // Run check after a brief delay to ensure everything is loaded
    const timer = setTimeout(checkAndSetLocal, 100);
    return () => clearTimeout(timer);
  }, []);

  return { timezone, updateTimezone, resetToLocal, clearTimezoneCache };
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