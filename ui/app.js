// Pagination state for Agents tab
const agentsPaging = {
  page: 1,
  pageSize: 15,
};

function applyAgentsPagination(list) {
  const total = list.length, size = agentsPaging.pageSize;
  const pages = Math.max(1, Math.ceil(total / size));
  if (agentsPaging.page > pages) agentsPaging.page = pages;
  const start = (agentsPaging.page - 1) * size, end = start + size;
  const info = document.getElementById("agents-page-info");
  if (info) {
    const from = total ? start + 1 : 0, to = Math.min(end, total);
    info.textContent = `${from}-${to} out of ${total}`;
  }
  return list.slice(start, end);
}

function attachAgentsPagingHandlers() {
  const ps = document.getElementById("agents-page-size");
  if (ps) {
    ps.value = String(agentsPaging.pageSize);
    ps.onchange = () => {
      agentsPaging.pageSize = parseInt(ps.value, 10) || 15;
      agentsPaging.page = 1;
      renderAgentsDetailTab();
    };
  }
  const prev = document.getElementById("agents-prev-page");
  const next = document.getElementById("agents-next-page");
  if (prev) prev.onclick = () => {
    if (agentsPaging.page > 1) {
      agentsPaging.page--;
      renderAgentsDetailTab();
    }
  };
  if (next) next.onclick = () => {
    // We need to know the total number of agents (after filtering)
    const total = (state.agents || []).length;
    const pages = Math.max(1, Math.ceil(total / agentsPaging.pageSize));
    if (agentsPaging.page < pages) {
      agentsPaging.page++;
      renderAgentsDetailTab();
    }
  };
}
// Clipboard copy for job drawer logs
document.addEventListener("DOMContentLoaded", function() {
  const copyBtn = document.getElementById("drawer-log-copy");
  const logPre = document.getElementById("drawer-log");
  if (copyBtn && logPre) {
    copyBtn.addEventListener("click", function() {
      const text = logPre.innerText || logPre.textContent || "";
      navigator.clipboard.writeText(text);
      copyBtn.classList.add("copied");
      setTimeout(() => copyBtn.classList.remove("copied"), 1200);
    });
  }
});
// ---- TimeRange early bootstrap (ensures availability before init) ----
(function(){
  if (!window.TimeRange) {
    window.TimeRange = {
      enabled: false,
      field: 'updated_at',
      mode: 'relative',
      relMins: 1440,
      abs: { fromMs: null, toMs: null },
      noTzPolicy: 'utc'
    };
  }
  if (typeof window.fmtRangeLabel !== 'function') {
    window.fmtRangeLabel = function(){
      const fieldLabel = (window.TimeRange.field === 'created_at') ? 'Created' : 'Updated';
      return window.TimeRange.enabled ? `${fieldLabel} in Last ${window.TimeRange.relMins/60}h` : `${fieldLabel}: All time`;
    };
  }
  if (typeof window.filterJobsByTime !== 'function') {
    window.filterJobsByTime = function(list){ return list; };
  }
})();

/* UI with global-only TZ dropdown (fixed-position), pagination (10/page), sorting, label chips. */
const $ = (id) => document.getElementById(id);

let BASE = (window.API_BASE || "/api");
const hdrs = () => ({});

const state = {
  jobs: [], agents: [],
  jobTimer: null, logTimer: null, currentJobId: null,
  sort: { key: "created_at", dir: "desc" },
  page: 1, pageSize: 15,
  filters: { job_id:"", status:"", agent_id:"", rc:"", created_at:"", updated_at:"", labels:"" },
};

let TZ = localStorage.getItem("router_ui_tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
window.TZ = TZ;

// ---------- TZ MENU (global only) ----------
function getSupportedTimezones() {
  try {
    if (Intl.supportedValuesOf) {
      const z = Intl.supportedValuesOf("timeZone");
      if (Array.isArray(z) && z.length) return z;
    }
  } catch {}
  return ["UTC","Asia/Kolkata","America/Los_Angeles","America/New_York","Europe/London","Europe/Berlin","Asia/Singapore","Asia/Tokyo","Australia/Sydney"];
}

function buildTzMenu() {
  if (window.__tz_inited) return; // prevent duplicate handlers on HMR/reloads
  window.__tz_inited = true;

  const wrap = $("tz-wrap"), btn = $("tz-btn"), menu = $("tz-menu"), lab = $("tz-label");
  if (!wrap || !btn || !menu || !lab) return;

  const zones = getSupportedTimezones();
  lab.textContent = formatTzLabel(TZ);
  menu.innerHTML = zones.map(z => `<button type="button" class="w-full text-left px-3 py-2 hover:bg-slate-100 ${z===TZ?'bg-slate-50':''}" data-tz="${z}">${z}</button>`).join("");
  /* tz-label-upgrade */
  menu.querySelectorAll('button[data-tz]').forEach(b => { b.textContent = formatTzLabel(b.dataset.tz); });


  function positionMenu() {
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    menu.style.top  = `${r.bottom + 4}px`;
  }
  const open  = () => { positionMenu(); menu.classList.remove("hidden"); };
  const close = () => { menu.classList.add("hidden"); };
  const toggle = () => { menu.classList.contains("hidden") ? open() : close(); };

  btn.addEventListener("mousedown", (e)=> e.preventDefault());
  btn.addEventListener("click", (e)=> { e.stopPropagation(); toggle(); });

  menu.addEventListener("click", (e)=>{
    const z = e.target?.dataset?.tz;
    if (!z) return;
    TZ = z; window.TZ = TZ; localStorage.setItem("router_ui_tz", TZ);
    lab.textContent = formatTzLabel(TZ);
    // Re-render all tables that show date/time columns
    renderJobs(state.jobs);
    renderByAgent(state.jobs);
    if (document.getElementById("tab-content-agents")?.style.display !== "none") {
      renderAgentsDetailTab();
    }
    // Also re-render analytics chart if visible
    const contentAnalytics = document.getElementById("tab-content-analytics");
    if (contentAnalytics && contentAnalytics.style.display !== "none") {
      let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
      if (typeof window.filterJobsByTime === 'function') jobs = window.filterJobsByTime(jobs);
      if (window.renderAnalyticsChart) window.renderAnalyticsChart(jobs);
    }
    close();
  });

  document.addEventListener("click", (e)=> { if (!menu.classList.contains("hidden") && !wrap.contains(e.target)) close(); });
  document.addEventListener("keydown", (e)=> { if (e.key === "Escape") close(); });
  window.addEventListener("resize", ()=> { if (!menu.classList.contains("hidden")) { positionMenu(); } });
}

// ---------- helpers ----------

function detectBrowserTZ(){
  try{
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    // Alias reconciliation examples (expand if you have more)
    const alias = {
      "Asia/Kolkata": "Asia/Kolkata",
      "Asia/Calcutta": "Asia/Kolkata"
    };
    return alias[tz] || tz;
  }catch(e){ return null; }
}


// ----- TZ helpers -----
function tzOffsetMinutes(tz, d=new Date()){
  try{
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const parts = dtf.formatToParts(d).reduce((acc, p)=>{ acc[p.type]=p.value; return acc; }, {});
    const y = Number(parts.year), m = Number(parts.month), da = Number(parts.day), h = Number(parts.hour), mi = Number(parts.minute), s = Number(parts.second);
    const asUTC = Date.UTC(y, m-1, da, h, mi, s);
    return Math.round((asUTC - d.getTime())/60000); // minutes ahead of UTC positive
  }catch(e){ return 0; }
}
function formatUtcOffset(tz){
  const mins = tzOffsetMinutes(tz);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hrs = Math.floor(abs/60), rem = abs % 60;
  if (rem === 0) return `UTC${sign}${hrs}`;
  if (rem === 30) return `UTC${sign}${hrs}.5`;
  if (rem === 45) return `UTC${sign}${hrs}.75`;
  if (rem === 15) return `UTC${sign}${hrs}.25`;
  // fallback
  return `UTC${sign}${hrs}:${String(rem).padStart(2,"0")}`;
}
function formatTzLabel(tz){ return `${tz} - (${formatUtcOffset(tz)})`; }

// Parse an instant robustly: if ISO has no timezone info, assume UTC (server-side timestamp)
function parseInstant(x){
  if (x == null) return null;
  if (typeof x === "number") return new Date(x);
  const s = String(x);
  if (/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  // Normalize space separator then assume UTC
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return new Date(s.replace(" ", "T")+"Z");
  return new Date(s);
}


function fitJobsHeight(){
  const el = $("jobs-scroll");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const bottomPad = 16;
  const available = Math.max(200, Math.floor(window.innerHeight - rect.top - bottomPad));
  const rowH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 34;
  const fifteenRows = (15 * rowH) + 112;
  el.style.maxHeight = Math.min(available, fifteenRows) + "px";
}

function norm(v){ return (v==null?'':String(v)).toLowerCase(); }
function includesAll(h, n){ return norm(h).includes(norm(n)); }
function matchLabels(labelsObj, q){
  if (!q) return true; const t=(q||'').trim(); if(!t) return true;
  try{ const kv=t.split(':'); if(kv.length===2){ const k=kv[0].trim(), v=kv[1].trim(); return includesAll((labelsObj||{})[k]||'', v); } }catch(e){}
  try{ return JSON.stringify(labelsObj||{}).toLowerCase().includes(t.toLowerCase()); }catch(e){ return false; }
}

const fmtDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: TZ, year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(parseInstant(iso));
  } catch { return iso; }
};
const fmtAgo = (iso) => {
  if (!iso) return "-";
  const t = parseInstant(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t)/1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h/24); return `${d}d ago`;
};

function showError(msg){ const el=$("error-banner"); if(!el) return; el.textContent=msg; el.classList.remove("hidden"); }
function hideError(){ const el=$("error-banner"); if(!el) return; el.classList.add("hidden"); }

async function fetchJSON(url, opts={}){
  const r = await fetch(url, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON from ${url}: ${text.slice(0,200)}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}: ${text.slice(0,200)}`);
  return data;
}
async function fetchAgents(){ const j = await fetchJSON(`${BASE}/agents`); return Array.isArray(j) ? j : (j.agents || []); }
async function fetchJobs(){
  const j = await fetchJSON(`${BASE}/jobs?limit=1000`);
  const arr = Array.isArray(j) ? j : (j.jobs || []);
  let testJobIds = [];
  try { testJobIds = JSON.parse(localStorage.getItem("testJobIds") || "[]"); } catch {}
  return arr.map(x => {
    const job_id = x.job_id || x.id || "";
    let labels = x.labels || {};
    // If job_id matches a test job (persisted), force label
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
}

// ---------- sorting & pagination ----------
function setSort(key){
  if (state.sort.key === key) state.sort.dir = (state.sort.dir === "asc" ? "desc" : "asc");
  else { state.sort.key = key; state.sort.dir = "asc"; }
  state.page = 1; renderJobs(state.jobs);
}
function applySort(list){
  const { key, dir } = state.sort; const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a,b) => {
    const va = a[key] ?? "", vb = b[key] ?? "";
    if (key.endsWith("_at")) return (new Date(va) - new Date(vb)) * mul;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
}
function renderSortIndicators(){
  ["job_id","status","agent_id","rc","created_at","updated_at"].forEach(k => {
    const el = $(`sort-${k}`); if (!el) return;
    el.textContent = (state.sort.key === k) ? (state.sort.dir === "asc" ? "▲" : "▼") : "";
  });
}
function applyPagination(list){
  const total = list.length, size = state.pageSize;
  const pages = Math.max(1, Math.ceil(total / size));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * size, end = start + size;
  const info = $("page-info");
  if (info) {
    const from = total ? start + 1 : 0, to = Math.min(end, total);
    info.textContent = `${from}-${to} out of ${total}`;
  }
  return list.slice(start, end);
}
function attachPagingHandlers(){
  const ps=$("page-size"); if(ps){ ps.value=String(state.pageSize); ps.onchange=()=>{ state.pageSize=parseInt(ps.value,10)||10; state.page=1; renderJobs(state.jobs); }; }
  const prev=$("prev-page"), next=$("next-page");
  if(prev) prev.onclick=()=>{ if(state.page>1){state.page--; renderJobs(state.jobs);} };
  if(next) next.onclick=()=>{ state.page++; renderJobs(state.jobs); };
}

// ---------- renderers ----------
function renderAgents(agents){
  const cnt=$("agent-count"); if (cnt) cnt.textContent = `${agents.length} total`;
  const tbody=$("agents-body"); if(!tbody) return;
  tbody.innerHTML = agents.map(a => {
    const labels = Object.entries(a.labels||{}).map(([k,v])=>`<span class="chip bg-slate-100">${k}:${v}</span>`).join(" ");
    return `<tr>
      <td class="p-2 font-mono">${a.agent_id}</td>
      <td class="p-2">${labels||"-"}</td>
      <td class="p-2 text-slate-500">${fmtDate(a.last_heartbeat)} · ${fmtAgo(a.last_heartbeat)}</td>
    </tr>`;
  }).join("");
}

function renderJobs(allJobs){
  fitJobsHeight();
  const q = ($("job-filter")?.value || "").trim().toLowerCase();
  let list = allJobs.filter(j => !q || j.job_id?.toLowerCase().includes(q) || (j.agent_id||"").toLowerCase().includes(q) || (j.status||"").toLowerCase().includes(q));
  list = applyJobColumnFilters(list);
  if (window.filterJobsByTime) { list = window.filterJobsByTime(list); }
  list = applySort(list); renderSortIndicators();
  const pageItems = applyPagination(list);
  renderFilterChips();
  const rows = pageItems.map(j => {
    const st = j.status || "-";
    const created = `${fmtDate(j.created_at, TZ)} · ${fmtAgo(j.created_at)}`;
    const updated = `${fmtDate(j.updated_at, TZ)} · ${fmtAgo(j.updated_at)}`;
    const labels = Object.entries(j.labels || {}).map(([k,v]) => `<span class="chip bg-slate-100">${k}:${v}</span>`).join(" ");
    return `<tr class="border-b hover:bg-slate-50">
      <td class="p-2 font-mono">${j.job_id}</td>
      <td class="p-2"><span class="chip st-${st}">${st}</span></td>
      <td class="p-2 font-mono">${j.agent_id || "-"}</td>
      <td class="p-2">${j.rc ?? "-"}</td>
      <td class="p-2">${created}</td>
      <td class="p-2">${updated}</td>
      <td class="p-2">${labels || "-"}</td>
      <td class="p-2">
        <button class="px-2 py-1 text-xs bg-slate-200 rounded" onclick="openDrawer('${j.job_id}','${st}','${j.agent_id||""}','${j.log_path||""}')">View</button>
      </td>
    </tr>`;
  }).join("");
  const tbody=$("jobs-body"); if(!tbody) return;
  tbody.innerHTML = rows || `<tr><td class="p-2 text-slate-500" colspan="8">No jobs</td></tr>`;
}

function renderByAgent(jobs){
  const tbody=$("byagent-body"); if(!tbody) return;
  const statusFilter = $("byagent-status")?.value || "";
  const q = ($("byagent-filter")?.value || "").trim().toLowerCase();
  const rows = jobs.filter(j => (!statusFilter || j.status===statusFilter) && (!q || (j.agent_id||"").toLowerCase().includes(q) || (j.job_id||"").toLowerCase().includes(q)))
    .map(j => `<tr class="border-b">
      <td class="p-2 font-mono">${j.agent_id || "-"}</td>
      <td class="p-2 font-mono">${j.job_id}</td>
      <td class="p-2"><span class="chip st-${j.status}">${j.status}</span></td>
      <td class="p-2">${j.rc ?? "-"}</td>
      <td class="p-2">${fmtDate(j.updated_at)} · ${fmtAgo(j.updated_at)}</td>
    </tr>`).join("");
  tbody.innerHTML = rows || `<tr><td class="p-2 text-slate-500" colspan="5">No jobs</td></tr>`;
}


// Helper: get job from current state by id
function findJobById(id){
  try { return (state.jobs||[]).find(j => String(j.job_id) === String(id)) || null; } catch { return null; }
}
// ---------- drawer / logs ----------
window.openDrawer = async (job_id, status, agent_id, log_path) => {
  state.currentJobId = job_id;
  const title=$("drawer-title"); if(title) title.textContent = `Job ${job_id}`;
  const j = findJobById(job_id) || {};
  const created = j.created_at ? `${fmtDate(j.created_at)} · ${fmtAgo(j.created_at)}` : "-";
  const updated = j.updated_at ? `${fmtDate(j.updated_at)} · ${fmtAgo(j.updated_at)}` : "-";
  const labelsHTML = Object.entries(j.labels || {}).map(([k,v]) => `<span class="chip bg-slate-100">${k}:${v}</span>`).join(" ");
  const meta=$("drawer-meta"); if(meta) meta.innerHTML = `<div class="text-sm space-y-1">\
    <div><b>Status:</b> ${status}</div>\
    <div><b>Agent:</b> ${agent_id || "-"}</div>\
    <div><b>RC:</b> -</div>\
    <div><b>Created:</b> ${created}</div>\
    <div><b>Updated:</b> ${updated}</div>\
    <div><b>Labels:</b> ${labelsHTML || "-"}</div>\
    <div><b>Log path:</b> <span class="font-mono">${log_path || "-"}</span></div>\
  </div>`;
  $("drawer")?.showModal();
  startLogFollow(job_id);
};
function closeDrawer(){ $("drawer")?.close(); stopLogFollow(); }
$("drawer-close")?.addEventListener("click", closeDrawer);

function stopLogFollow(){ if (state.logTimer) clearInterval(state.logTimer); state.logTimer = null; }
function startLogFollow(job_id){
  stopLogFollow();
  const follow = async () => {
    try {
      const s = await fetchJSON(`${BASE}/status/${job_id}`);
      const meta=$("drawer-meta"); if(meta){
        const base = findJobById(job_id) || {};
        const createdSrc = (s.created_at ?? base.created_at);
        const updatedSrc = (s.updated_at ?? base.updated_at);
        const labelsSrc = (s.labels ?? base.labels ?? {});
        const created = createdSrc ? `${fmtDate(createdSrc)} · ${fmtAgo(createdSrc)}` : "-";
        const updated = updatedSrc ? `${fmtDate(updatedSrc)} · ${fmtAgo(updatedSrc)}` : "-";
        const labelsHTML = Object.entries(labelsSrc).map(([k,v]) => `<span class="chip bg-slate-100">${k}:${v}</span>`).join(" ");
        meta.innerHTML = `<div class="text-sm space-y-1">\
          <div><b>Status:</b> ${s.status}</div>\
          <div><b>Agent:</b> ${s.agent_id || "-"}</div>\
          <div><b>RC:</b> ${s.rc ?? "-"}</div>\
          <div><b>Created:</b> ${created}</div>\
          <div><b>Updated:</b> ${updated}</div>\
          <div><b>Labels:</b> ${labelsHTML || "-"}</div>\
          <div><b>Log path:</b> <span class="font-mono">${s.log_path || base.log_path || "-"}</span></div>\
        </div>`;
      }
      const r = await fetch(`${BASE}/logs/${job_id}`);
      const txt = await r.text();
      const pre=$("drawer-log"); if(pre){ pre.textContent = txt; pre.scrollTop = pre.scrollHeight; }
      if ((s.status === "SUCCEEDED" || s.status === "FAILED") && !$("log-autorefresh").checked) stopLogFollow();
    } catch(e){ /* ignore */ }
  };
  follow();
  state.logTimer = setInterval(()=>{ if ($("log-autorefresh")?.checked) follow(); }, 2000);
}

// ---------- agents detail tab with shared time range ----------
function agentJobInTimeRange(job) {
  // Use shared TimeRange
  if (!window.TimeRange.enabled) return true;
  const field = window.TimeRange.field || 'updated_at';
  const v = job[field];
  const t = toTs(v);
  if (isNaN(t)) return false;
  if (window.TimeRange.mode === 'relative') {
    const to = Date.now();
    const from = to - window.TimeRange.relMins * 60 * 1000;
    return t >= from && t <= to;
  } else {
    const { fromMs, toMs } = window.TimeRange.abs;
    if (fromMs && t < fromMs) return false;
    if (toMs && t > toMs) return false;
    return true;
  }
}

async function renderAgentsDetailTab(){
  const body=$("agents-detail-body"); if (!body) return;
  const colTitle = document.getElementById("agents-jobs-col-title");
  if (colTitle) colTitle.textContent = `Jobs (${fmtRangeLabel()})`;
  const counts = {};
  await Promise.all(state.agents.map(async a => {
      try {
        const j = await fetchJSON(`${BASE}/jobs?limit=1000&agent_id=${encodeURIComponent(a.agent_id)}`);
        const arr = Array.isArray(j) ? j : (j.jobs || []);
        counts[a.agent_id] = arr.filter(agentJobInTimeRange).length;
      } catch {
        counts[a.agent_id] = 0;
      }
  }));
  const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
  // Apply pagination to agents list
  const pagedAgents = applyAgentsPagination(state.agents || []);
  body.innerHTML = pagedAgents.map((a, idx) => {
    const labels = Object.entries(a.labels||{}).map(([k,v]) => `<span class=\"chip bg-slate-100\">${k}:${v}</span>`).join(" ");
    let status = "Offline";
    let lastHbMs = toTs(a.last_heartbeat);
    let nowMs = Date.now();
    if (a.active && lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      status = "Registered";
    } else if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      status = "Discovered";
    }
    // Add Deregister button only for Registered agents
    const rowId = `agent-row-${idx}`;
    const deregBtn = (status === "Registered") ? `<button class=\"px-2 py-1 text-xs bg-red-200 rounded agent-dereg-btn\" data-rowid=\"${rowId}\" onclick=\"deregisterAgent('${a.agent_id}')\">Deregister</button>` : "";
            // Add large Unicode Play button for all agents with tooltip, no background or border
            // Play button: green and clickable if Registered, else greyed out and unclickable
            let playColor = '#22c55e';
            let playCursor = 'pointer';
            let playDisabled = false;
            let playTooltip = 'Submit a Test Job';
            if (status !== 'Registered') {
              playColor = '#cbd5e1'; // Tailwind slate-300
              playCursor = 'not-allowed';
              playDisabled = true;
              playTooltip = 'Test Job can only be submitted for Registered/Available agents';
            }
            const testJobBtn = `
              <span class=\"relative group\" style=\"display:inline-block;margin-right:0.7em;\">
                <button class=\"agent-testjob-btn\" data-agentid=\"${a.agent_id}\" ${playDisabled ? 'tabindex=\"-1\" disabled' : ''} onclick=\"${!playDisabled ? `openTestJobDialog('${a.agent_id}')` : ''}\" style=\"background:none;border:none;padding:0;vertical-align:middle;font-size:2em;color:${playColor};line-height:1;cursor:${playCursor};\">&#x25B6;</button>
                <span class=\"invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-1 rounded bg-slate-800 text-white text-xs whitespace-nowrap z-10\" style=\"pointer-events:none;\">${playTooltip}</span>
              </span>`;
      // Add a span with a unique id for dynamic update, monospace and min-width for stable layout
      return `<tr id=\"${rowId}\" class=\"border-b border-slate-200\">
        <td class=\"p-2 font-mono\">${a.agent_id}</td>
        <td class=\"p-2 font-mono\">${a.url}</td>
        <td class=\"p-2\">${labels || "-"}</td>
        <td class=\"p-2\">${status}</td>
        <td class=\"p-2 text-slate-500\"><span id=\"agent-hb-${a.agent_id}\">${fmtDate(a.last_heartbeat, TZ)} · ${fmtAgo(a.last_heartbeat)}</span></td>
        <td class=\"p-2\">${counts[a.agent_id] ?? 0}</td>
        <td class=\"p-2\">${testJobBtn} ${deregBtn}</td>
      </tr>`;
  }).join("");

  // Set up dynamic update for Heartbeat column (only for visible agents)
  if (window.__agent_hb_interval) clearInterval(window.__agent_hb_interval);
  window.__agent_hb_interval = setInterval(() => {
    (pagedAgents || []).forEach(a => {
      const el = document.getElementById(`agent-hb-${a.agent_id}`);
      if (el) {
        el.textContent = `${fmtDate(a.last_heartbeat, TZ)} · ${fmtAgo(a.last_heartbeat)}`;
      }
    });
  }, 1000);

  // Attach pagination handlers (safe to call multiple times)
  attachAgentsPagingHandlers();

  // Add hover effect for Deregister button
  setTimeout(() => {
    document.querySelectorAll('.agent-dereg-btn').forEach(btn => {
      const rowId = btn.getAttribute('data-rowid');
      const row = document.getElementById(rowId);
      if (row) {
        btn.addEventListener('mouseenter', () => row.classList.add('agent-row-highlight'));
        btn.addEventListener('mouseleave', () => row.classList.remove('agent-row-highlight'));
      }
    });
  }, 0);

  // Attach deregisterAgent to window
  window.deregisterAgent = async function(agent_id) {
    const banner = document.getElementById("agents-banner");
    if (!banner) return;
    // Show confirmation banner
    banner.className = "mb-2 px-3 py-2 rounded text-sm bg-yellow-50 text-yellow-800 border border-yellow-200";
    banner.textContent = `Deregister agent ${agent_id}? `;
    banner.innerHTML += `<button id='agents-confirm-dereg' class='ml-2 px-2 py-1 rounded bg-red-100 text-red-700'>Confirm</button> <button id='agents-cancel-dereg' class='ml-2 px-2 py-1 rounded bg-slate-100'>Cancel</button>`;
    banner.style.display = "block";
    document.getElementById('agents-confirm-dereg').onclick = async function() {
      banner.textContent = "Processing...";
      try {
        const resp = await fetch(`${BASE}/agents/deregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.ROUTER_TOKEN || "router-secret"}` },
          body: JSON.stringify({ agent_id })
        });
        const data = await resp.json();
        if (data.ok) {
          banner.className = "mb-2 px-3 py-2 rounded text-sm bg-green-50 text-green-800 border border-green-200";
          banner.textContent = `Agent ${agent_id} deregistered.`;
          setTimeout(()=>{ banner.style.display = "none"; }, 2500);
          // Refresh agents table only (not whole page)
          const agents = await fetchAgents();
          state.agents = agents;
          renderAgentsDetailTab();
        } else {
          banner.className = "mb-2 px-3 py-2 rounded text-sm bg-red-50 text-red-800 border border-red-200";
          banner.textContent = `Error: ${data.error || "Unknown error"}`;
        }
      } catch (e) {
        banner.className = "mb-2 px-3 py-2 rounded text-sm bg-red-50 text-red-800 border border-red-200";
        banner.textContent = `Request failed: ${e}`;
      }
    };
    document.getElementById('agents-cancel-dereg').onclick = function() {
      banner.style.display = "none";
    };
  };
}
  // Attach openTestJobDialog to window
  window.openTestJobDialog = function(agent_id) {
    const agentSel = document.getElementById("tj-agent");
    if (agentSel) {
      agentSel.value = agent_id;
      // Trigger change event to update button state/banner
      const event = new Event('change', { bubbles: true });
      agentSel.dispatchEvent(event);
    }
    updateSubmitButtonState && updateSubmitButtonState();
    const dialog = document.getElementById("submit-dialog");
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
  };


// Shared Time Range UI logic for both tabs
document.addEventListener("DOMContentLoaded", function() {
  const trBtn = document.getElementById("tr-btn-shared");
  const trPop = document.getElementById("tr-pop-shared");
  const trLabel = document.getElementById("tr-label-shared");
  const fromInput = document.getElementById('tr-from-shared');
  const toInput = document.getElementById('tr-to-shared');
  if (trBtn && trPop && trLabel) {
    const open = () => { trPop.classList.remove("hidden"); };
    const close = () => { trPop.classList.add("hidden"); };
    trBtn.addEventListener("mousedown", e => e.preventDefault());
    trBtn.addEventListener("click", e => { e.stopPropagation(); open(); });
    document.addEventListener("click", e => { if (!trPop.classList.contains("hidden") && !trPop.contains(e.target) && e.target !== trBtn) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    // Quick ranges
    trPop.querySelectorAll('.tr-q-shared').forEach(btn => {
      btn.addEventListener('click', function() {
        window.TimeRange.enabled = true;
        window.TimeRange.mode = 'relative';
        if (this.dataset.mins) window.TimeRange.relMins = parseInt(this.dataset.mins);
        else if (this.dataset.today) { window.TimeRange.mode = 'absolute';
          const now = new Date();
          const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          window.TimeRange.abs.fromMs = from.getTime();
          window.TimeRange.abs.toMs = now.getTime();
        } else if (this.dataset.yesterday) {
          window.TimeRange.mode = 'absolute';
          const now = new Date();
          const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
          const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          window.TimeRange.abs.fromMs = from.getTime();
          window.TimeRange.abs.toMs = to.getTime();
        }
        trLabel.textContent = fmtRangeLabel();
        close();
        renderJobs(state.jobs);
        renderAgentsDetailTab();
        // Also update Analytics chart if visible
        const contentAnalytics = document.getElementById("tab-content-analytics");
        if (contentAnalytics && contentAnalytics.style.display !== "none") {
          let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
          if (typeof window.filterJobsByTime === 'function') jobs = window.filterJobsByTime(jobs);
          if (window.renderAnalyticsChart) window.renderAnalyticsChart(jobs);
        }
      });
    });
    // Field radio
    trPop.querySelectorAll('input[name="tr-field-shared"]').forEach(radio => {
      radio.addEventListener('change', function() {
        window.TimeRange.field = this.value;
        trLabel.textContent = fmtRangeLabel();
        renderJobs(state.jobs);
        renderAgentsDetailTab();
        // Also update Analytics chart if visible
        const contentAnalytics = document.getElementById("tab-content-analytics");
        if (contentAnalytics && contentAnalytics.style.display !== "none") {
          let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
          if (typeof window.filterJobsByTime === 'function') jobs = window.filterJobsByTime(jobs);
          if (window.renderAnalyticsChart) window.renderAnalyticsChart(jobs);
        }
      });
    });
    // Absolute range
    document.getElementById('tr-apply-shared').addEventListener('click', function() {
      window.TimeRange.enabled = true;
      window.TimeRange.mode = 'absolute';
      window.TimeRange.abs.fromMs = fromInput && fromInput.value ? (new Date(fromInput.value)).getTime() : null;
      window.TimeRange.abs.toMs = toInput && toInput.value ? (new Date(toInput.value)).getTime() : null;
      trLabel.textContent = fmtRangeLabel();
      close();
      renderJobs(state.jobs);
      renderAgentsDetailTab();
      // Also update Analytics chart if visible
      const contentAnalytics = document.getElementById("tab-content-analytics");
      if (contentAnalytics && contentAnalytics.style.display !== "none") {
        let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
        if (typeof window.filterJobsByTime === 'function') jobs = window.filterJobsByTime(jobs);
        if (window.renderAnalyticsChart) window.renderAnalyticsChart(jobs);
      }
    });
    document.getElementById('tr-clear-shared').addEventListener('click', function() {
      window.TimeRange.enabled = false;
      trLabel.textContent = fmtRangeLabel();
      close();
      renderJobs(state.jobs);
      renderAgentsDetailTab();
      // Also update Analytics chart if visible
      const contentAnalytics = document.getElementById("tab-content-analytics");
      if (contentAnalytics && contentAnalytics.style.display !== "none") {
        let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
        if (window.renderAnalyticsChart) window.renderAnalyticsChart(jobs);
      }
    });
    document.getElementById('tr-cancel-shared').addEventListener('click', function() {
      close();
    });
    trLabel.textContent = fmtRangeLabel();
  }
});

// Tab switching logic
document.addEventListener("DOMContentLoaded", function() {
  const tabJobs = document.getElementById("tab-jobs");
  const tabAgents = document.getElementById("tab-agents");
  const tabAnalytics = document.getElementById("tab-analytics");
  const contentJobs = document.getElementById("tab-content-jobs");
  const contentAgents = document.getElementById("tab-content-agents");
  const contentAnalytics = document.getElementById("tab-content-analytics");
  if (tabJobs && tabAgents && tabAnalytics && contentJobs && contentAgents && contentAnalytics) {
    tabJobs.addEventListener("click", function() {
      tabJobs.classList.add("active");
      tabAgents.classList.remove("active");
      tabAnalytics.classList.remove("active");
      contentJobs.style.display = "block";
      contentAgents.style.display = "none";
      contentAnalytics.style.display = "none";
    });
    tabAgents.addEventListener("click", function() {
      tabAgents.classList.add("active");
      tabJobs.classList.remove("active");
      tabAnalytics.classList.remove("active");
      contentJobs.style.display = "none";
      contentAgents.style.display = "block";
      contentAnalytics.style.display = "none";
      renderAgentsDetailTab();
    });
    tabAnalytics.addEventListener("click", function() {
      tabAnalytics.classList.add("active");
      tabJobs.classList.remove("active");
      tabAgents.classList.remove("active");
      contentJobs.style.display = "none";
      contentAgents.style.display = "none";
      contentAnalytics.style.display = "block";
      // On first open, default to All Time if not set
      if (typeof window.TimeRange !== 'undefined') {
        if (window.TimeRange.enabled !== false) {
          window.TimeRange.enabled = false;
          const trLabel = document.getElementById("tr-label-shared");
          if (trLabel) trLabel.textContent = (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
        }
      }
      // Render chart for all jobs (All Time)
      let jobs = (window.state && Array.isArray(window.state.jobs)) ? window.state.jobs : (typeof state !== 'undefined' && Array.isArray(state.jobs) ? state.jobs : []);
      if (window.renderAnalyticsChart) {
        window.renderAnalyticsChart(jobs);
      }
    });
  }
});
$("submit-open")?.addEventListener("click", () => {
  const agentSel = $("tj-agent");
  if (agentSel) agentSel.value = "";
  updateSubmitButtonState();
  $("submit-dialog")?.showModal();
});
$("submit-close")?.addEventListener("click", () => $("submit-dialog")?.close());

// ---------- submit test job ----------
async function submitTestJob(){
  const cmd = $("tj-command")?.value.trim() || "";
  const agent = $("tj-agent")?.value.trim() || "";
  let labels = {}; try { labels = JSON.parse(($("tj-labels")?.value || "{}")); } catch {}
  labels["job-type"] = "test";
  // Persist test job id in localStorage
  let testJobIds = [];
  try { testJobIds = JSON.parse(localStorage.getItem("testJobIds") || "[]"); } catch {}
  // Only use labels for routing that are not 'job-type'
  const routingLabels = { ...labels };
  delete routingLabels["job-type"];
  const route = agent ? { agent_id: agent } : { labels: routingLabels };
  const payload = { command: cmd, labels };
  const out = $("tj-out"); if (out) out.textContent = "submitting...";
  const banner = document.getElementById("tj-agent-status-banner");
  // Only clear previous agent status banner, not for test job submit message
  if (banner) {
    banner.classList.add("hidden");
    banner.textContent = "";
    banner.className = "hidden mb-2 px-3 py-2 rounded text-sm";
  }
  try {
    const r = await fetch(`${BASE}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: payload, route }) });
    const text = await r.text();
    if (out) out.textContent = text;
    refreshAll();
    // Try to extract job_id from response (robust)
    let jobId = "";
    try {
      // Try JSON parse first
      const jobObj = JSON.parse(text);
      if (jobObj && jobObj.job_id) jobId = jobObj.job_id;
      else if (jobObj && jobObj.id) jobId = jobObj.id;
    } catch {
      // Fallback to regex
      const jobMatch = text.match(/job_id\s*[:=]\s*['\"]?(\w+)["']?/i);
      if (jobMatch) jobId = jobMatch[1];
    }
    // If jobId found, store in localStorage and start polling for status
    if (jobId) {
      if (!testJobIds.includes(jobId)) {
        testJobIds.push(jobId);
        localStorage.setItem("testJobIds", JSON.stringify(testJobIds));
      }
  // (Removed) No test job submitted message display
      let pollCount = 0;
      let lastStatus = "RUNNING";
      const pollStatus = async () => {
        pollCount++;
        try {
          const statusResp = await fetch(`${BASE}/status/${jobId}`);
          const statusData = await statusResp.json();
          // Update job in state.jobs
          let updated = false;
          state.jobs = (state.jobs || []).map(j => {
            if (String(j.job_id) === String(jobId)) {
              if (j.status !== statusData.status) updated = true;
              lastStatus = statusData.status;
              // Ensure job-type label is retained
              const mergedLabels = { ...j.labels, ...statusData.labels };
              if (!mergedLabels["job-type"]) mergedLabels["job-type"] = "test";
              return { ...j, status: statusData.status, rc: statusData.rc, updated_at: statusData.updated_at, labels: mergedLabels };
            }
            return j;
          });
          if (updated) renderJobs(state.jobs);
          if (lastStatus === "RUNNING" && pollCount < 60) {
            setTimeout(pollStatus, 2000); // poll every 2s, max 2min
          } else {
            renderJobs(state.jobs);
          }
        } catch {
          // If error, try again up to max pollCount
          if (pollCount < 60) setTimeout(pollStatus, 2000);
        }
      };
      pollStatus();
    }
  } catch (e) {
    if (out) out.textContent = "error: " + e.message;
  }
}
$("tj-send")?.addEventListener("click", submitTestJob);

// ---------- refresh ----------
async function refreshAll(){
  try{
    hideError();
    const [agents, jobs] = await Promise.all([fetchAgents(), fetchJobs()]);
    state.agents = agents; state.jobs = jobs;
    const sel = $("tj-agent");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = `<option value="">(Any agent via labels)</option>` + agents.map(a => `<option value="${a.agent_id}">${a.agent_id}</option>`).join("");
      // Restore previous selection if still present
      if (prev && agents.some(a => a.agent_id === prev)) sel.value = prev;
    }
    renderAgents(agents); renderJobs(jobs); renderByAgent(jobs);
  }catch(e){ console.error(e); showError(e.message); }
}

function attachSortHandlers(){ document.querySelectorAll('th[data-sort]').forEach(th => { th.onclick = () => setSort(th.dataset.sort); }); }

(function init(){
  try {
    const saved = localStorage.getItem('TZ');
    const btz = detectBrowserTZ();
    if (!saved && btz) { TZ = btz; }
  } catch(e){}

  buildTzMenu();
  attachSortHandlers();
  attachPagingHandlers();
  bindJobColumnFilters();
  renderFilterChips();
  $("job-filter")?.addEventListener("input", () => { state.page = 1; renderJobs(state.jobs); });
  $("byagent-status")?.addEventListener("change", () => renderByAgent(state.jobs));
  $("byagent-filter")?.addEventListener("input", () => renderByAgent(state.jobs));
  const ar = $("autorefresh");
  const manualRefreshBtn = $("manual-refresh");
  const setManualRefreshState = () => {
    if (ar?.checked) {
      manualRefreshBtn.disabled = true;
      manualRefreshBtn.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      manualRefreshBtn.disabled = false;
      manualRefreshBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  };
  const schedule = () => {
    if (state.jobTimer) clearInterval(state.jobTimer);
    state.jobTimer = setInterval(refreshAll, 2000);
  };
  if (!ar || ar.checked) schedule();
  setManualRefreshState();
  ar?.addEventListener("change", () => {
    if (ar.checked) schedule();
    else {
      if (state.jobTimer) clearInterval(state.jobTimer);
      state.jobTimer = null;
    }
    setManualRefreshState();
  });
  manualRefreshBtn?.addEventListener("click", () => {
    if (!manualRefreshBtn.disabled) {
      // Add visual feedback
      const icon = document.getElementById("refresh-icon");
      if (icon) {
        icon.classList.add("animate-spin");
        manualRefreshBtn.classList.add("bg-blue-100", "ring", "ring-blue-300");
        setTimeout(() => {
          icon.classList.remove("animate-spin");
          manualRefreshBtn.classList.remove("bg-blue-100", "ring", "ring-blue-300");
        }, 700);
      }
      refreshAll();
    }
  });
  // --- Submit Test Job button enable/disable logic ---
  const tjAgent = $("tj-agent");
  const tjSend = $("tj-send");
  function updateSubmitButtonState(isRefreshing = false) {
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
    let agent = (state.agents||[]).find(a => a.agent_id === selectedId);
    let fromCache = false;
    if (!agent && agentStatusCache[selectedId]) {
      status = agentStatusCache[selectedId].status;
      colorClass = agentStatusCache[selectedId].colorClass;
      fromCache = true;
    } else if (agent) {
      const lastHbMs = typeof toTs === 'function' ? toTs(agent.last_heartbeat) : (agent.last_heartbeat ? new Date(agent.last_heartbeat).getTime() : 0);
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
  }
  tjAgent?.addEventListener("change", () => updateSubmitButtonState());
  // Also update on refreshAll (agents list changes)
  const origRefreshAll = refreshAll;
  window.refreshAll = async function() {
    // Show spinner only if cache is being used
    updateSubmitButtonState(true);
    await origRefreshAll.apply(this, arguments);
    updateSubmitButtonState(false);
    // If Analytics tab is visible, re-render chart
    const analyticsTab = document.getElementById("tab-analytics");
    const analyticsContent = document.getElementById("tab-content-analytics");
    if (analyticsTab && analyticsContent && analyticsContent.style.display !== "none") {
      if (window.renderAnalyticsChart && window.state && Array.isArray(window.state.jobs)) {
        let jobs = window.state.jobs;
        if (typeof window.filterJobsByTime === 'function') jobs = window.filterJobsByTime(jobs);
        window.renderAnalyticsChart(jobs);
      }
    }
  };
  updateSubmitButtonState();
  refreshAll();
})();
function applyJobColumnFilters(list){
  const f = state.filters || {};
  let out = list.slice();
  if (f.job_id) out = out.filter(r => includesAll(r.job_id||'', f.job_id));
  if (f.status) out = out.filter(r => String(r.status||'').toUpperCase() === String(f.status).toUpperCase());
  if (f.agent_id) out = out.filter(r => includesAll(r.agent_id||'', f.agent_id));
  if (f.rc !== '' && f.rc != null) out = out.filter(r => String(r.rc) === String(f.rc));
  if (f.created_at) out = out.filter(r => includesAll(fmtDate(r.created_at), f.created_at));
  if (f.updated_at) out = out.filter(r => includesAll(fmtDate(r.updated_at), f.updated_at));
  if (f.labels) out = out.filter(r => matchLabels(r.labels, f.labels));
  return out;
}

function currentFilterChips(){
  const f = state.filters || {}; const chips = [];
  Object.entries(f).forEach(([k,v]) => { if (v!=null && String(v).trim()!=='') chips.push({key:k, value:String(v).trim()}); });
  // Add TimeRange chip
  try {
    if (window.TimeRange && window.TimeRange.enabled) {
      const label = (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
      chips.unshift({key:'timerange', value: label});
    }
  } catch(e){}
  return chips;
}
function renderFilterChips(){
    // Guard: TimeRange module may load later in the bundle
  if (typeof window.TimeRange === 'undefined') { return; }
// TimeRange chip
  const chipsWrap = document.getElementById('jobs-chips');
  if (chipsWrap){
    const existing = document.getElementById('chip-timerange');
    if (existing) existing.remove();
    if (window.TimeRange.enabled){
      const span = document.createElement('span');
      span.id = 'chip-timerange';
      span.className = 'chip bg-slate-200 flex items-center gap-1';
      span.style.cursor = 'default';

      const label = document.createElement('span');
      label.textContent =  (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
      span.appendChild(label);

      const close = document.createElement('button');
      close.textContent = '×';
      close.className = 'ml-1 w-4 h-4 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-400 hover:text-white';
      close.style.cursor = 'pointer';
      close.onclick = (e) => {
        e.stopPropagation();
        window.TimeRange.enabled = false;
        // Update the Kibana-like filter dropdown label to 'All Time'
        const trLabel = document.getElementById('tr-label');
        if (trLabel) trLabel.textContent = (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Updated: All time');
        if (typeof refreshJobs === 'function') refreshJobs();
        span.remove();
      };
      span.appendChild(close);

      chipsWrap.appendChild(span);
    }
  }

  const host = $("jobs-chips"); if (!host) return;
  const chips = currentFilterChips();
  if (!chips.length){ host.innerHTML=''; return; }
  host.innerHTML = chips.map(c => {
    if (c.key === 'timerange') {
      return `<span class="chip bg-slate-200 inline-flex items-center gap-1">
        <span class="text-xs"><strong>${c.value}</strong></span>
        <button data-chip="${c.key}" class="ml-1 text-xs px-1 rounded bg-slate-300">×</button>
      </span>`;
    }
    return `<span class="chip bg-slate-200 inline-flex items-center gap-1">
       <span class="text-xs">${c.key}: <strong>${c.value}</strong></span>
       <button data-chip="${c.key}" class="ml-1 text-xs px-1 rounded bg-slate-300">×</button>
     </span>`;
  }).join(" ");
  host.querySelectorAll('button[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.chip;
      if (k === 'timerange') {
        if (window.TimeRange) window.TimeRange.enabled = false;
        // Also update the Kibana-like filter dropdown label to 'All Time'
        const trLabel = document.getElementById('tr-label');
        if (trLabel) trLabel.textContent = (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Updated: All time');
      } else {
        state.filters[k] = '';
        const el = document.getElementById('f-'+k);
        if (el){ if(el.tagName==='SELECT') el.value=''; else el.value=''; }
      }
      state.page=1; renderJobs(state.jobs);
    });
  });
}
function bindJobColumnFilters(){
  const ids = ['job_id','status','agent_id','rc','created_at','updated_at','labels'];
  ids.forEach(k => {
    const el = $('f-'+k); if (!el) return;
    const handler = () => { state.filters[k]=(el.value||'').trim(); state.page=1; renderJobs(state.jobs); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
  const clr = $('f-clear-all');
  if (clr){
    clr.addEventListener('click', () => {
      Object.keys(state.filters).forEach(k => state.filters[k]='');
      ids.forEach(k => { const el=$('f-'+k); if(el){ if(el.tagName==='SELECT') el.value=''; else el.value=''; } });
      state.page=1; renderJobs(state.jobs);
    });
  }
}



/* ==== Time Range (Kibana-like) Module ===================================== */
const TimeRange = {
  enabled: true,
  field: 'updated_at',
  mode: 'relative',
  relMins: 1440,
  abs: { fromMs: null, toMs: null },
  noTzPolicy: 'utc'  // how to parse ISO without TZ: 'utc' or 'local'
};

function fmtRangeLabel(now = Date.now()) {
  const fieldLabel = (window.TimeRange.field === 'created_at') ? 'Created' : 'Updated';
  if (!window.TimeRange.enabled) return `${fieldLabel}: All time`;
  if (window.TimeRange.mode === 'relative') {
    const mins = window.TimeRange.relMins;
    let rangeText = '';
    if (mins % (24*60) === 0) rangeText = `Last ${mins/(24*60)}d`;
    else if (mins % 60 === 0) rangeText = `Last ${mins/60}h`;
    else rangeText = `Last ${mins}m`;
    return `${fieldLabel} in ${rangeText}`;
  } else {
    const f = (ms) => new Date(ms).toLocaleString();
    const { fromMs, toMs } = window.TimeRange.abs;
    const fromText = fromMs ? f(fromMs) : '–';
    const toText = toMs ? f(toMs) : 'Now';
    return `${fieldLabel} from ${fromText} → ${toText}`;
  }
}

function filterJobsByTime(jobs){
  if (!window.TimeRange.enabled) return jobs;
  let from=null, to=null;
  if (window.TimeRange.mode === 'relative') {
    to = Date.now();
    from = to - window.TimeRange.relMins * 60 * 1000;
  } else {
    from = window.TimeRange.abs?.fromMs ?? null;
    to   = window.TimeRange.abs?.toMs ?? null;
  }
  const field = window.TimeRange.field || 'updated_at';

  const pass = [];
  for (let i=0;i<jobs.length;i++){
    const j = jobs[i];
    const t = toTs(j?.[field]);
    if (!Number.isFinite(t)) continue;
    if (from!=null && t < from) continue;
    if (to!=null && t > to) continue;
    pass.push(j);
  }

  if (window.__timeDebug){
    const fmt = (ms) => ms==null ? 'null' : (new Date(ms)).toString();
    console.log('[TimeRange] mode=', window.TimeRange.mode, 'field=', field, 'from=', fmt(from), 'to=', fmt(to), 'kept=', pass.length, 'of', jobs.length);
    if (pass.length===0){
      const sample = jobs.slice(0,5).map(j=>({id:j.job_id, raw:j?.[field], ts: toTs(j?.[field])}));
      console.warn('[TimeRange] first5 parsed:', sample);
    }
  }

  return pass;
}

function initTimeRangeUI(){
  const $ = (id) => document.getElementById(id);
  const btn = $('tr-btn'); const pop = $('tr-pop'); const label = $('tr-label');
  const fromInput = $('tr-from'); const toInput = $('tr-to');

  if(!btn || !pop){ return; }

  btn.addEventListener('click', () => {
    pop.classList.toggle('hidden');
    if (window.TimeRange.mode === 'absolute' && window.TimeRange.abs.fromMs) {
      fromInput.value = new Date(window.TimeRange.abs.fromMs).toISOString().slice(0,16);
      toInput.value = new Date(window.TimeRange.abs.toMs || Date.now()).toISOString().slice(0,16);
    } else {
      const to = new Date(); const from = new Date(Date.now() - 24*60*60*1000);
      toInput.value = to.toISOString().slice(0,16); fromInput.value = from.toISOString().slice(0,16);
    }
  });
  document.addEventListener('click', (e)=>{
    if(!pop.contains(e.target) && !btn.contains(e.target)) pop.classList.add('hidden');
  });
  document.querySelectorAll('#tr-pop .tr-q').forEach(q => {
    q.addEventListener('click', (e) => {
      const t = e.currentTarget;
      const minsAttr = t.getAttribute('data-mins');
      const today = t.hasAttribute('data-today');
      const yest = t.hasAttribute('data-yesterday');

      if (minsAttr) {
        window.TimeRange.mode='relative'; window.TimeRange.relMins=parseInt(minsAttr,10); window.TimeRange.enabled=true;
      } else if (today) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const end = start + 24*60*60*1000 - 1;
        window.TimeRange.mode='absolute'; window.TimeRange.enabled=true; window.TimeRange.abs={fromMs:start,toMs:end};
      } else if (yest) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 24*60*60*1000;
        const end = start + 24*60*60*1000 - 1;
        window.TimeRange.mode='absolute'; window.TimeRange.enabled=true; window.TimeRange.abs={fromMs:start,toMs:end};
      }

      const selectedField = document.querySelector('input[name="tr-field"]:checked')?.value || 'updated_at';
      window.TimeRange.field = selectedField;
      label.textContent =  (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
      if (typeof refreshJobs === 'function') refreshJobs();
      pop.classList.add('hidden');
    });
  });
  document.querySelectorAll('input[name="tr-field"]').forEach(r => {
    r.addEventListener('change', () => {
      window.TimeRange.field = r.value; label.textContent =  (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
      if (typeof refreshJobs === 'function') refreshJobs();
    });
  });
  const clearBtn = document.getElementById('tr-clear');
  const cancelBtn = document.getElementById('tr-cancel');
  const applyBtn = document.getElementById('tr-apply');
  clearBtn?.addEventListener('click', () => { window.TimeRange.enabled=false; label.textContent='All time'; if (typeof refreshJobs==='function') refreshJobs(); });
  cancelBtn?.addEventListener('click', () => pop.classList.add('hidden'));
  applyBtn?.addEventListener('click', () => {
    const f = fromInput.value ? Date.parse(fromInput.value) : null;
    const t = toInput.value ? Date.parse(toInput.value) : null;
    const { fromMs, toMs } = clampAbs(f, t);
    window.TimeRange.mode='absolute'; window.TimeRange.enabled=true; window.TimeRange.abs={fromMs, toMs};
    const selectedField = document.querySelector('input[name="tr-field"]:checked')?.value || 'updated_at';
    window.TimeRange.field = selectedField;
    label.textContent =  (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
    if (typeof refreshJobs === 'function') refreshJobs();
    pop.classList.add('hidden');
  });

  label.textContent =  (typeof fmtRangeLabel==='function' ? fmtRangeLabel() : 'Time filter');
}

document.addEventListener('DOMContentLoaded', initTimeRangeUI);
window.filterJobsByTime = filterJobsByTime;
/* ==== /Time Range Module ================================================ */


/* ==== Time Range Helpers (fixed) ==== */
function clampAbs(fromMs, toMs) {
  if (fromMs && toMs && toMs < fromMs) [fromMs, toMs] = [toMs, fromMs];
  return { fromMs, toMs };
}

/* Robust timestamp parser: supports epoch seconds, epoch millis, ISO strings */
function toTs(v){
  if (v == null) return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string'){
    let s = v.trim();
    if (!s) return NaN;

    // 1) Epoch seconds/millis
    if (/^\d{10}$/.test(s)) return parseInt(s,10) * 1000;
    if (/^\d{13}$/.test(s)) return parseInt(s,10);

    // 2) ISO with microseconds and explicit TZ -> trim to millis, parse
    let m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,})(Z|[+\-]\d{2}:?\d{2})$/);
    if (m){
      const [_, base, frac, tz] = m;
      const ms3 = frac.slice(0,3).padEnd(3,'0');
      const t = Date.parse(`${base}.${ms3}${tz}`);
      return t || NaN;
    }

    // 3) ISO with microseconds but **no TZ**
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3,})$/);
    if (m){
      const [, Y, MM, DD, hh, mm, ss, frac] = m;
      const ms = parseInt(frac.slice(0,3).padEnd(3,'0'), 10);
      if ((TimeRange?.noTzPolicy || 'utc') === 'utc') {
        const t = Date.UTC(Number(Y), Number(MM)-1, Number(DD), Number(hh), Number(mm), Number(ss), ms);
        return t;
      } else {
        const dt = new Date(Number(Y), Number(MM)-1, Number(DD), Number(hh), Number(mm), Number(ss), ms);
        return dt.getTime();
      }
    }

    // 4) ISO without microseconds and with explicit TZ -> parse as-is
    m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+\-]\d{2}:?\d{2})$/);
    if (m){
      const t = Date.parse(s);
      return t || NaN;
    }

    // 5) ISO without microseconds and **no TZ**
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m){
      const [, Y, MM, DD, hh, mm, ss='0'] = m;
      if ((TimeRange?.noTzPolicy || 'utc') === 'utc') {
        return Date.UTC(Number(Y), Number(MM)-1, Number(DD), Number(hh), Number(mm), Number(ss), 0);
      } else {
        return new Date(Number(Y), Number(MM)-1, Number(DD), Number(hh), Number(mm), Number(ss), 0).getTime();
      }
    }

    // 6) YYYY/MM/DD or YYYY-MM-DD [HH:mm[:ss]] => interpret as local
    m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      const [_, Y, M, D, h='0', mnt='0', s2='0'] = m;
      const dt = new Date(Number(Y), Number(M)-1, Number(D), Number(h), Number(mnt), Number(s2));
      return dt.getTime();
    }

    // 7) DD-MM-YYYY or DD/MM/YYYY [HH:mm[:ss]] => interpret as local
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      const [_, d1, d2, Y, h='0', mnt='0', s2='0'] = m;
      const dt = new Date(Number(Y), Number(d2)-1, Number(d1), Number(h), Number(mnt), Number(s2));
      return dt.getTime();
    }

    // 8) "29 Sep 2025 13:45:00" or "29 Sep 2025" => interpret as local
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const [_, D, Mon, Y, h='0', mnt='0', s2='0'] = m;
      const mi = months[Mon.slice(0,3).toLowerCase()];
      if (mi!=null){
        const dt = new Date(Number(Y), mi, Number(D), Number(h), Number(mnt), Number(s2));
        return dt.getTime();
      }
    }

    // 9) Fallback: try native parse (keeps TZ if present)
    const t = Date.parse(s.includes(' ') ? s.replace(' ', 'T') : s);
    return t || NaN;
  }
  return NaN;
}
// Make toTs available globally for analytics chart
window.toTs = toTs;

function jobInTimeRange(job){
  if (!window.TimeRange.enabled) return true;
  const field = window.TimeRange.field || 'updated_at';
  const v = job[field];
  const t = toTs(v);
  if (isNaN(t)) {
    // Debug: log jobs with invalid timestamps
    console.debug('Job excluded due to invalid timestamp:', job.job_id, field, v);
    return false;
  }
  if (window.TimeRange.mode === 'relative') {
    const to = Date.now();
    const from = to - window.TimeRange.relMins * 60 * 1000;
    // Debug: log time range and job timestamp
    //console.debug('Checking job', job.job_id, 't:', t, 'from:', from, 'to:', to);
    return t >= from && t <= to;
  } else {
    const { fromMs, toMs } = window.TimeRange.abs;
    if (fromMs && t < fromMs) return false;
    if (toMs && t > toMs) return false;
    return true;
  }
}
/* ==== /Time Range Helpers ==== */

