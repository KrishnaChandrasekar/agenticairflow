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
    TZ = z; localStorage.setItem("router_ui_tz", TZ);
    lab.textContent = formatTzLabel(TZ);
    renderAgents(state.agents); renderJobs(state.jobs); renderByAgent(state.jobs);
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
  return arr.map(x => ({
    job_id: x.job_id || x.id || "", status: (x.status || "").toUpperCase(),
    agent_id: x.agent_id || "", rc: (x.rc !== undefined ? x.rc : null),
    log_path: x.log_path || "", created_at: x.created_at || x.createdAt || null,
    updated_at: x.updated_at || x.updatedAt || null, labels: x.labels || {},
  }));
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
  list = applySort(list); renderSortIndicators();
  const pageItems = applyPagination(list);
  renderFilterChips();
  const rows = pageItems.map(j => {
    const st = j.status || "-";
    const created = `${fmtDate(j.created_at)} · ${fmtAgo(j.created_at)}`;
    const updated = `${fmtDate(j.updated_at)} · ${fmtAgo(j.updated_at)}`;
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

// ---------- drawer / logs ----------
window.openDrawer = async (job_id, status, agent_id, log_path) => {
  state.currentJobId = job_id;
  const title=$("drawer-title"); if(title) title.textContent = `Job ${job_id}`;
  const meta=$("drawer-meta"); if(meta) meta.innerHTML = `<div class="text-sm space-y-1">
    <div><b>Status:</b> ${status}</div>
    <div><b>Agent:</b> ${agent_id || "-"}</div>
    <div><b>Log path:</b> <span class="font-mono">${log_path || "-"}</span></div>
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
      const meta=$("drawer-meta"); if(meta) meta.innerHTML = `<div class="text-sm space-y-1">
        <div><b>Status:</b> ${s.status}</div>
        <div><b>Agent:</b> ${s.agent_id || "-"}</div>
        <div><b>RC:</b> ${s.rc ?? "-"}</div>
      </div>`;
      const r = await fetch(`${BASE}/logs/${job_id}`);
      const txt = await r.text();
      const pre=$("drawer-log"); if(pre){ pre.textContent = txt; pre.scrollTop = pre.scrollHeight; }
      if ((s.status === "SUCCEEDED" || s.status === "FAILED") && !$("log-autorefresh").checked) stopLogFollow();
    } catch(e){ /* ignore */ }
  };
  follow();
  state.logTimer = setInterval(()=>{ if ($("log-autorefresh")?.checked) follow(); }, 2000);
}

// ---------- agents detail dialog ----------
async function renderAgentsDetailAndOpen(){
  const body=$("agents-detail-body"); if (!body) return;
  const counts = {};
  await Promise.all(state.agents.map(async a => {
    try{
      const j = await fetchJSON(`${BASE}/jobs?limit=1000&agent_id=${encodeURIComponent(a.agent_id)}&since_hours=24`);
      const arr = Array.isArray(j) ? j : (j.jobs||[]);
      counts[a.agent_id] = Array.isArray(arr) ? arr.length : 0;
    } catch { counts[a.agent_id] = 0; }
  }));
  body.innerHTML = state.agents.map(a => {
    const labels = Object.entries(a.labels||{}).map(([k,v]) => `<span class="chip bg-slate-100">${k}:${v}</span>`).join(" ");
    return `<tr>
      <td class="p-2 font-mono">${a.agent_id}</td>
      <td class="p-2 font-mono">${a.url}</td>
      <td class="p-2">${labels||"-"}</td>
      <td class="p-2">${a.active ? "yes" : "no"}</td>
      <td class="p-2 text-slate-500">${fmtDate(a.last_heartbeat)} · ${fmtAgo(a.last_heartbeat)}</td>
      <td class="p-2">${counts[a.agent_id] ?? 0}</td>
    </tr>`;
  }).join("");
  $("agents-dialog")?.showModal();
}
$("agents-open")?.addEventListener("click", renderAgentsDetailAndOpen);
$("agents-close")?.addEventListener("click", () => $("agents-dialog")?.close());
$("submit-open")?.addEventListener("click", () => $("submit-dialog")?.showModal());
$("submit-close")?.addEventListener("click", () => $("submit-dialog")?.close());

// ---------- submit test job ----------
async function submitTestJob(){
  const cmd = $("tj-command")?.value.trim() || "";
  const agent = $("tj-agent")?.value.trim() || "";
  let labels = {}; try { labels = JSON.parse(($("tj-labels")?.value || "{}")); } catch {}
  const route = agent ? { agent_id: agent } : { labels };
  const payload = { command: cmd };
  const out=$("tj-out"); if(out) out.textContent = "submitting...";
  try{
    const r = await fetch(`${BASE}/submit`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ job: payload, route }) });
    const text = await r.text();
    if(out) out.textContent = text;
    refreshAll();
  }catch(e){ if(out) out.textContent = "error: "+e.message; }
}
$("tj-send")?.addEventListener("click", submitTestJob);

// ---------- refresh ----------
async function refreshAll(){
  try{
    hideError();
    const [agents, jobs] = await Promise.all([fetchAgents(), fetchJobs()]);
    state.agents = agents; state.jobs = jobs;
    const sel=$("tj-agent"); if (sel) sel.innerHTML = `<option value="">(Any agent via labels)</option>` + agents.map(a => `<option value="${a.agent_id}">${a.agent_id}</option>`).join("");
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
  const ar=$("autorefresh"); const schedule=()=>{ if (state.jobTimer) clearInterval(state.jobTimer); state.jobTimer=setInterval(refreshAll, 2000); };
  if (!ar || ar.checked) schedule();
  ar?.addEventListener("change", () => { if (ar.checked) schedule(); else { if (state.jobTimer) clearInterval(state.jobTimer); state.jobTimer=null; } });
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
  return chips;
}
function renderFilterChips(){
  const host = $("jobs-chips"); if (!host) return;
  const chips = currentFilterChips();
  if (!chips.length){ host.innerHTML=''; return; }
  host.innerHTML = chips.map(c => (
    `<span class="chip bg-slate-200 inline-flex items-center gap-1">
       <span class="text-xs">${c.key}: <strong>${c.value}</strong></span>
       <button data-chip="${c.key}" class="ml-1 text-xs px-1 rounded bg-slate-300">×</button>
     </span>`
  )).join(" ");
  host.querySelectorAll('button[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.chip; state.filters[k]=''; const el=$('f-'+k); if(el){ if(el.tagName==='SELECT') el.value=''; else el.value=''; }
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
