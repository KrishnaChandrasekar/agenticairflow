// Make updateSubmitButtonState globally available for all event handlers
window.updateSubmitButtonState = function(isRefreshing = false) {
  const tjAgent = document.getElementById("tj-agent");
  const tjSend = document.getElementById("tj-send");
  if (!tjAgent || !tjSend) return;
  const banner = document.getElementById("tj-agent-status-banner");
  const selectedId = tjAgent.value.trim();
  // Spinner HTML
  const spinner = '<span class="inline-block align-middle ml-2 animate-spin" style="width:1em;height:1em;border:2px solid #cbd5e1;border-top:2px solid #64748b;border-radius:50%;border-right-color:transparent;"></span>';
  // Read cache
  let agentStatusCache = {};
  try { agentStatusCache = JSON.parse(localStorage.getItem("agentStatusCache") || '{}'); } catch {}
  let status = "Offline";
  let colorClass = "bg-red-50 text-red-700 border border-red-200";
  if (!selectedId) {
    tjSend.disabled = false;
    tjSend.classList.remove("opacity-50", "cursor-not-allowed");
    if (banner) {
      banner.classList.add("hidden");
      banner.textContent = "";
    }
    return;
  }
  // Use cache if no agent info yet
  let agent = (window.state?.agents||[]).find(a => a.agent_id === selectedId);
  let fromCache = false;
  if (!agent && agentStatusCache[selectedId]) {
    status = agentStatusCache[selectedId].status;
    colorClass = agentStatusCache[selectedId].colorClass;
    fromCache = true;
  } else if (agent) {
    const lastHbMs = typeof window.toTs === 'function' ? window.toTs(agent.last_heartbeat) : (agent.last_heartbeat ? new Date(agent.last_heartbeat).getTime() : 0);
    const nowMs = Date.now();
    const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;
    if (agent.active && lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      status = "Registered";
      colorClass = "bg-green-50 text-green-800 border border-green-200";
    } else if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      status = "Discovered";
      colorClass = "bg-yellow-50 text-yellow-800 border border-yellow-200";
    }
    // Update cache
    agentStatusCache[selectedId] = { status, colorClass, ts: Date.now() };
    localStorage.setItem("agentStatusCache", JSON.stringify(agentStatusCache));
  }
  if (banner) {
    banner.className = `mb-2 px-3 py-2 rounded text-sm ${colorClass}`;
    let txt = selectedId ? `Agent status: ${selectedId} is ${status}` : `Agent status: ${status}`;
    // Only show spinner if refreshing and using cache (i.e., not after fresh data)
    if (isRefreshing && fromCache) txt += spinner;
    banner.innerHTML = txt;
    banner.classList.remove("hidden");
  }
  if (status === "Registered") {
    tjSend.disabled = false;
    tjSend.classList.remove("opacity-50", "cursor-not-allowed");
  } else {
    tjSend.disabled = true;
    tjSend.classList.add("opacity-50", "cursor-not-allowed");
  }
};
