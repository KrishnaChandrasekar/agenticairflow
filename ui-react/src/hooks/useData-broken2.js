import { useEffect, useState, useCallback, useRef } fr  const updateTimezone = useCallback((tz) => {
    console.log('🎯 USER ACTION: Changing timezone to:', tz);
    console.log('  - Previous timezone:', timezone);
    console.log('  - Previous localStorage value:', localStorage.getItem("router_ui_tz"));
    
    // Replicate original UI: TZ = z; window.TZ = TZ; localStorage.setItem("router_ui_tz", TZ);
    setTimezone(tz);
    localStorage.setItem("router_ui_tz", tz);
    window.TZ = tz; // Keep window.TZ in sync for any old UI components
    
    console.log('✅ AFTER CHANGE:');
    console.log('  - New timezone state:', tz);
    console.log('  - New localStorage value:', localStorage.getItem("router_ui_tz"));
    console.log('  - window.TZ set to:', window.TZ);
    console.log('💾 Next page refresh will use this stored value:', tz);
  }, [timezone]);
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
  
  // EXACT SAME LOGIC as original UI: remember user choice OR default to local
  const [timezone, setTimezone] = useState(() => {
    console.log('🔍 TIMEZONE INITIALIZATION DEBUG:');
    
    // Step 1: Check what's in localStorage
    const stored = localStorage.getItem("router_ui_tz");
    console.log('  1️⃣ localStorage.getItem("router_ui_tz"):', stored);
    
    // Step 2: Detect browser timezone
    const detected = detectBrowserTZ();
    console.log('  2️⃣ detectBrowserTZ():', detected);
    
    // Step 3: Fallback
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('  3️⃣ Raw browser timezone:', fallback);
    
    // Step 4: Apply original UI logic
    const initialTZ = stored || detected || fallback;
    console.log('  4️⃣ FINAL CHOICE (stored || detected || fallback):', initialTZ);
    
    // Step 5: Check if this matches what user expects
    if (stored && stored !== detected) {
      console.log('  ⚠️  IMPORTANT: Using stored timezone', stored, 'instead of local', detected);
      console.log('  ⚠️  This is why timezone persists across page loads (original UI behavior)');
    } else {
      console.log('  ✅ Using local timezone as expected');
    }
    
    return initialTZ;
  });

  const updateTimezone = useCallback((tz) => {
    console.log('🎯 User selecting timezone:', tz, '(same as original UI logic)');
    
    // Replicate original UI: TZ = z; window.TZ = TZ; localStorage.setItem("router_ui_tz", TZ);
    setTimezone(tz);
    localStorage.setItem("router_ui_tz", tz);
    window.TZ = tz; // Keep window.TZ in sync for any old UI components
    
    console.log('✅ Timezone updated to:', tz);
    console.log('� Stored in localStorage for future page loads');
  }, []);

  const resetToLocal = useCallback(() => {
    console.log('🏠 Reset to local timezone');
    const localTZ = detectBrowserTZ() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    window.TZ = localTZ;
    console.log('✅ Reset to local timezone:', localTZ);
    return localTZ;
  }, []);

  const clearTimezoneCache = useCallback(() => {
    console.log('🗑️ Clearing timezone cache (will default to local on next load)');
    localStorage.removeItem("router_ui_tz");
    const localTZ = detectBrowserTZ() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(localTZ);
    localStorage.setItem("router_ui_tz", localTZ);
    window.TZ = localTZ;
    console.log('✅ Cache cleared, reset to local timezone:', localTZ);
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