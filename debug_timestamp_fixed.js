// Test the fixed timestamp parsing
const toTs = (v) => {
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

// Test with the actual API timestamp format
const testTimestamp = "2025-10-05T06:22:10.602297";
const parsedTs = toTs(testTimestamp);
const currentTs = Date.now();
const diff = currentTs - parsedTs;

console.log("Test timestamp:", testTimestamp);
console.log("Parsed timestamp (ms):", parsedTs);
console.log("Current timestamp (ms):", currentTs);
console.log("Time difference (ms):", diff);
console.log("Time difference (seconds):", diff / 1000);
console.log("Is timestamp valid?", !isNaN(parsedTs));
console.log("Is within 20 seconds?", Math.abs(diff) < 20000);

// Test agent status logic with fixed parsing
const OFFLINE_THRESHOLD_MS = 20 * 1000;
const agent = { 
  active: true, 
  last_heartbeat: testTimestamp 
};

const getAgentStatus = (agent) => {
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = Date.now();
  
  if (lastHbMs && Math.abs(nowMs - lastHbMs) < OFFLINE_THRESHOLD_MS) {
    return agent.active ? "Registered" : "Discovered";
  }
  return "Offline";
};

const getAgentAvailability = (agent) => {
  const lastHbMs = toTs(agent.last_heartbeat);
  const nowMs = Date.now();
  
  if (lastHbMs && Math.abs(nowMs - lastHbMs) < OFFLINE_THRESHOLD_MS) {
    return agent.active ? "Active" : "Inactive";
  }
  return "Inactive";
};

console.log("Agent status:", getAgentStatus(agent));
console.log("Agent availability:", getAgentAvailability(agent));