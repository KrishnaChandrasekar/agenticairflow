// Configuration
export const API_BASE = window.API_BASE || "http://localhost:8000";

// Timezone utilities
export const getSupportedTimezones = () => {
  let zones = [];
  
  try {
    if (Intl.supportedValuesOf) {
      zones = Intl.supportedValuesOf("timeZone");
      if (!Array.isArray(zones) || !zones.length) {
        throw new Error("No supported timezones found");
      }
    } else {
      throw new Error("Intl.supportedValuesOf not available");
    }
  } catch {
    // Fallback list of common timezones
    zones = [
      "UTC", "Asia/Kolkata", "America/Los_Angeles", "America/New_York", 
      "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"
    ];
  }
  
  // Ensure local timezone is included and appears first
  try {
    const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (localTZ && !zones.includes(localTZ)) {
      zones.unshift(localTZ);
    } else if (localTZ && zones.includes(localTZ)) {
      // Move local timezone to the top
      zones = zones.filter(tz => tz !== localTZ);
      zones.unshift(localTZ);
    }
  } catch (error) {
    console.warn('Failed to detect local timezone for dropdown:', error);
  }
  
  return zones;
};

export const detectBrowserTZ = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    const alias = {
      "Asia/Kolkata": "Asia/Kolkata",
      "Asia/Calcutta": "Asia/Kolkata"
    };
    return alias[tz] || tz;
  } catch(e) { 
    return null; 
  }
};

export const tzOffsetMinutes = (tz, d = new Date()) => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { 
      timeZone: tz, 
      hour12: false, 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const parts = dtf.formatToParts(d).reduce((acc, p) => { 
      acc[p.type] = p.value; 
      return acc; 
    }, {});
    const y = Number(parts.year), m = Number(parts.month), da = Number(parts.day);
    const h = Number(parts.hour), mi = Number(parts.minute), s = Number(parts.second);
    const asUTC = Date.UTC(y, m-1, da, h, mi, s);
    return Math.round((asUTC - d.getTime()) / 60000);
  } catch(e) { 
    return 0; 
  }
};

export const formatUtcOffset = (tz) => {
  const mins = tzOffsetMinutes(tz);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hrs = Math.floor(abs / 60), rem = abs % 60;
  if (rem === 0) return `UTC${sign}${hrs}`;
  if (rem === 30) return `UTC${sign}${hrs}.5`;
  if (rem === 45) return `UTC${sign}${hrs}.75`;
  if (rem === 15) return `UTC${sign}${hrs}.25`;
  return `UTC${sign}${hrs}:${String(rem).padStart(2, "0")}`;
};

export const formatTzLabel = (tz) => `${tz} - (${formatUtcOffset(tz)})`;

// Get timezone abbreviation for a given timezone
export const getTimezoneAbbr = (tz, date = new Date()) => {
  try {
    // Get the timezone abbreviation using Intl.DateTimeFormat
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short'
    });
    
    const parts = formatter.formatToParts(date);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    
    if (timeZonePart && timeZonePart.value) {
      // Handle some common cases where Intl returns generic abbreviations
      const abbreviation = timeZonePart.value;
      
      // Map some common timezone identifiers to more recognizable abbreviations
      const commonMappings = {
        'Asia/Kolkata': 'IST',
        'Asia/Singapore': 'SGT', 
        'Asia/Tokyo': 'JST',
        'Europe/London': isDST(tz, date) ? 'BST' : 'GMT',
        'America/New_York': isDST(tz, date) ? 'EDT' : 'EST',
        'America/Los_Angeles': isDST(tz, date) ? 'PDT' : 'PST',
        'Europe/Berlin': isDST(tz, date) ? 'CEST' : 'CET',
        'Australia/Sydney': isDST(tz, date) ? 'AEDT' : 'AEST'
      };
      
      return commonMappings[tz] || abbreviation;
    }
    
    // Fallback to UTC offset format
    return formatUtcOffset(tz).replace('UTC', '');
  } catch (error) {
    // Fallback to UTC offset format  
    return formatUtcOffset(tz).replace('UTC', '');
  }
};

// Helper function to determine if DST is in effect
const isDST = (tz, date = new Date()) => {
  try {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    
    const janOffset = tzOffsetMinutes(tz, jan);
    const julOffset = tzOffsetMinutes(tz, jul);
    const currentOffset = tzOffsetMinutes(tz, date);
    
    // DST is in effect if current offset is different from standard time
    return currentOffset !== Math.max(janOffset, julOffset);
  } catch {
    return false;
  }
};

// Parse an instant robustly: if ISO has no timezone info, assume UTC
export const parseInstant = (x) => {
  if (x == null) return null;
  if (typeof x === "number") return new Date(x);
  const s = String(x);
  if (/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) 
    return new Date(s.replace(" ", "T") + "Z");
  return new Date(s);
};

// Date formatting
export const fmtDate = (iso, tz) => {
  if (!iso) return "-";
  try {
    const date = parseInstant(iso);
    const formattedDate = new Intl.DateTimeFormat(undefined, {
      timeZone: tz, 
      year: "numeric", 
      month: "short", 
      day: "2-digit",
      hour: "2-digit", 
      minute: "2-digit", 
      second: "2-digit"
    }).format(date);
    
    const tzAbbr = getTimezoneAbbr(tz, date);
    return `${formattedDate} ${tzAbbr}`;
  } catch { 
    return iso; 
  }
};

export const fmtAgo = (iso) => {
  if (!iso) return "-";
  const t = parseInstant(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); 
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); 
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); 
  return `${d}d ago`;
};

// API utilities
export const getAuthHeaders = () => ({
  'Authorization': 'Bearer router-secret',
  'Content-Type': 'application/json',
});

export const fetchJSON = async (url, opts = {}) => {
  // Add authorization header for API calls
  const headers = {
    ...getAuthHeaders(),
    ...opts.headers
  };
  
  const r = await fetch(url, { ...opts, headers });
  const text = await r.text();
  let data;
  try { 
    data = JSON.parse(text); 
  } catch { 
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 200)}`); 
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}: ${text.slice(0, 200)}`);
  return data;
};

// Filter utilities
export const norm = (v) => (v == null ? '' : String(v)).toLowerCase();
export const includesAll = (h, n) => norm(h).includes(norm(n));

export const matchLabels = (labelsObj, q) => {
  if (!q) return true; 
  const t = (q || '').trim(); 
  if (!t) return true;
  try { 
    const kv = t.split(':'); 
    if (kv.length === 2) { 
      const k = kv[0].trim(), v = kv[1].trim(); 
      return includesAll((labelsObj || {})[k] || '', v); 
    } 
  } catch(e) {}
  try { 
    return JSON.stringify(labelsObj || {}).toLowerCase().includes(t.toLowerCase()); 
  } catch(e) { 
    return false; 
  }
};

// Time range utilities
export const toTs = (v) => {
  if (v == null) return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    let s = v.trim();
    if (!s) return NaN;

    // Epoch seconds/millis
    if (/^\d{10}$/.test(s)) return parseInt(s, 10) * 1000;
    if (/^\d{13}$/.test(s)) return parseInt(s, 10);

    // ISO with microseconds and explicit TZ
    let m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,})(Z|[+\-]\d{2}:?\d{2})$/);
    if (m) {
      const [_, base, frac, tz] = m;
      const ms3 = frac.slice(0, 3).padEnd(3, '0');
      const t = Date.parse(`${base}.${ms3}${tz}`);
      return t || NaN;
    }

    // ISO without microseconds and with explicit TZ
    m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+\-]\d{2}:?\d{2})$/);
    if (m) {
      const t = Date.parse(s);
      return t || NaN;
    }

    // ISO without TZ - assume UTC (like API timestamps)
    m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/);
    if (m) {
      const t = Date.parse(s + 'Z');
      return t || NaN;
    }

    // Fallback: try native parse
    const t = Date.parse(s.includes(' ') ? s.replace(' ', 'T') : s);
    return t || NaN;
  }
  return NaN;
};