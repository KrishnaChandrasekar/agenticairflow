// --- Change detection helpers ---
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a || {}), kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

// --- Chart renderers with animation only on data change ---
let prevDualGauge = null;
let prevJobsHeatmap = null;
let prevAirflowDonut = null;
let prevTestDonut = null;
let prevJobTypeDonut = null;
  function renderDualGauge(jobs) {
  const dualGauge_total = jobs.length;
  const dualGauge_succeeded = jobs.filter(j => j.status === "SUCCEEDED").length;
  const dualGauge_rate = dualGauge_total ? dualGauge_succeeded / dualGauge_total : 0;
  const dualGauge_percent = Math.round(dualGauge_rate * 100);
  const curData = {total: dualGauge_total, succeeded: dualGauge_succeeded, percent: dualGauge_percent};
  const shouldAnimate = !deepEqual(curData, prevDualGauge);
  prevDualGauge = JSON.parse(JSON.stringify(curData));
  const svg = document.getElementById("analytics-dual-gauge");
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const total = jobs.length;
  const succeeded = jobs.filter(j => j.status === "SUCCEEDED").length;
  const rate = total ? succeeded / total : 0;
  const percent = Math.round(rate * 100);
  const width = 340, height = 170, cx = width/2, cy = height*0.8, r = 100;
    // Draw background arc (full gauge)
    const arcBg = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startAngle = Math.PI, endAngle = 0;
    const arcPath = (sa, ea, color, strokeWidth) => {
      const x1 = cx + r * Math.cos(sa), y1 = cy + r * Math.sin(sa);
      const x2 = cx + r * Math.cos(ea), y2 = cy + r * Math.sin(ea);
      const largeArc = ea - sa <= Math.PI ? 0 : 1;
      return `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2}`;
    };
    arcBg.setAttribute("d", arcPath(startAngle, endAngle, "#e5e7eb", 12));
    arcBg.setAttribute("stroke", "#e5e7eb");
    arcBg.setAttribute("stroke-width", "14");
    arcBg.setAttribute("fill", "none");
    svg.appendChild(arcBg);
  // Draw foreground arc (success rate) with animation
  const arcFg = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arcFg.setAttribute("stroke", "#22c55e");
  arcFg.setAttribute("stroke-width", "14");
  arcFg.setAttribute("fill", "none");
  arcFg.setAttribute("stroke-linecap", "round");
  svg.appendChild(arcFg);
  // Prepare text elements before animation logic
  const textTotal = document.createElementNS("http://www.w3.org/2000/svg", "text");
  textTotal.setAttribute("x", cx);
  textTotal.setAttribute("y", cy - 8);
  textTotal.setAttribute("text-anchor", "middle");
  textTotal.setAttribute("font-size", "2.9em");
  textTotal.setAttribute("font-weight", "700");
  textTotal.setAttribute("fill", "#222933");
  textTotal.textContent = total;
  svg.appendChild(textTotal);
  // Success rate below (animated)
  const textRate = document.createElementNS("http://www.w3.org/2000/svg", "text");
  textRate.setAttribute("x", cx);
  textRate.setAttribute("y", cy + 28);
  textRate.setAttribute("text-anchor", "middle");
  textRate.setAttribute("font-size", "1.8em");
  textRate.setAttribute("font-weight", "600");
  textRate.setAttribute("fill", "#22c55e");
  textRate.textContent = "0%";
  svg.appendChild(textRate);
  // Animate arc and percent text
  if (shouldAnimate) {
    let animStart;
    const animDuration = 900; // ms
    function animateGauge(ts) {
      if (!animStart) animStart = ts;
      const progress = Math.min(1, (ts - animStart) / animDuration);
      const curRate = dualGauge_rate * progress;
      const fgEnd = Math.PI + curRate * Math.PI;
      arcFg.setAttribute("d", arcPath(startAngle, fgEnd, "#22c55e", 12));
      // Animate percent text
      textRate.textContent = Math.round(dualGauge_percent * progress) + "%";
      if (progress < 1) requestAnimationFrame(animateGauge);
      else textRate.textContent = dualGauge_percent + "%";
    }
    requestAnimationFrame(animateGauge);
  } else {
    arcFg.setAttribute("d", arcPath(startAngle, Math.PI + dualGauge_rate * Math.PI, "#22c55e", 12));
    textRate.textContent = dualGauge_percent + "%";
  }
  }
  function renderScatterPlot(jobs) {
    const svg = document.getElementById("analytics-scatterplot");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Prepare data: duration (ms), time (x), agent (color)
    const data = jobs
      .filter(j => j.created_at && j.updated_at && j.agent_id)
      .map(j => {
        const start = window.toTs ? window.toTs(j.created_at) : Date.parse(j.created_at);
        const end = window.toTs ? window.toTs(j.updated_at) : Date.parse(j.updated_at);
        return {
          duration: (end - start) / 1000, // seconds
          time: end,
          agent: j.agent_id || "?"
        };
      })
      .filter(d => d.duration >= 0 && Number.isFinite(d.duration) && Number.isFinite(d.time));
    if (!data.length) return;
    const width = svg.clientWidth || 720, height = 320, margin = {top: 32, right: 32, bottom: 48, left: 64};
    // X: time
    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.time))
      .range([margin.left, width - margin.right]);
    // Y: duration
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.duration) || 1]).nice()
      .range([height - margin.bottom, margin.top]);
    // Color: agent
    const agents = Array.from(new Set(data.map(d => d.agent)));
    const color = d3.scaleOrdinal().domain(agents).range(d3.schemeCategory10);
    // Draw axes
    const xAxis = d3.axisBottom(x).ticks(6).tickFormat(d => {
      try {
        return new Intl.DateTimeFormat(undefined, {hour:'2-digit',minute:'2-digit',month:'short',day:'2-digit'}).format(new Date(d));
      } catch { return new Date(d).toLocaleString(); }
    });
    const yAxis = d3.axisLeft(y).ticks(6);
    // SVG axes
    const gX = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gX.setAttribute("transform", `translate(0,${height - margin.bottom})`);
    svg.appendChild(gX);
    d3.select(gX).call(xAxis);
    const gY = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gY.setAttribute("transform", `translate(${margin.left},0)`);
    svg.appendChild(gY);
    d3.select(gY).call(yAxis);
    // Dots
    data.forEach(d => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", x(d.time));
      circle.setAttribute("cy", y(d.duration));
      circle.setAttribute("r", 5);
      circle.setAttribute("fill", color(d.agent));
      circle.setAttribute("opacity", 0.8);
      // Tooltip
      circle.addEventListener("mousemove", evt => {
        let tooltip = document.getElementById("analytics-scatter-tooltip");
        if (!tooltip) {
          tooltip = document.createElement("div");
          tooltip.id = "analytics-scatter-tooltip";
          tooltip.style.position = "fixed";
          tooltip.style.pointerEvents = "none";
          tooltip.style.background = "#fff";
          tooltip.style.border = "1px solid #888";
          tooltip.style.borderRadius = "6px";
          tooltip.style.padding = "8px 12px";
          tooltip.style.fontSize = "14px";
          tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
          tooltip.style.zIndex = 1000;
          tooltip.style.display = "none";
          document.body.appendChild(tooltip);
        }
        tooltip.innerHTML = `<b>Agent:</b> ${d.agent}<br><b>Duration:</b> ${d.duration.toFixed(1)}s<br><b>Time:</b> ${new Date(d.time).toLocaleString()}`;
        tooltip.style.display = "block";
        tooltip.style.left = (evt.clientX + 18) + "px";
        tooltip.style.top = (evt.clientY - 10) + "px";
      });
      circle.addEventListener("mouseleave", () => {
        const tooltip = document.getElementById("analytics-scatter-tooltip");
        if (tooltip) tooltip.style.display = "none";
      });
      svg.appendChild(circle);
    });
    // Axis labels
    const xLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xLabel.setAttribute("x", width/2);
    xLabel.setAttribute("y", height - 8);
    xLabel.setAttribute("text-anchor", "middle");
    xLabel.setAttribute("font-size", "1em");
    xLabel.setAttribute("fill", "#334155");
    xLabel.textContent = "End Time";
    svg.appendChild(xLabel);
    const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yLabel.setAttribute("x", 18);
    yLabel.setAttribute("y", height/2);
    yLabel.setAttribute("text-anchor", "middle");
    yLabel.setAttribute("font-size", "1em");
    yLabel.setAttribute("fill", "#334155");
    yLabel.setAttribute("transform", `rotate(-90 18,${height/2})`);
    yLabel.textContent = "Duration (s)";
    svg.appendChild(yLabel);
  }
  function renderJobsHeatmap(jobs) {
    const jobsHeatmap_counts = Array.from({length: 7}, () => Array(24).fill(0));
    jobs.forEach(job => {
      const t = window.toTs ? window.toTs(job[window.TimeRange?.field || "updated_at"]) : Date.parse(job[window.TimeRange?.field || "updated_at"]);
      if (!Number.isFinite(t)) return;
      const date = new Date(t);
      const day = date.getDay();
      const hour = date.getHours();
      jobsHeatmap_counts[day][hour]++;
    });
    const shouldAnimate = !deepEqual(jobsHeatmap_counts, prevJobsHeatmap);
    prevJobsHeatmap = JSON.parse(JSON.stringify(jobsHeatmap_counts));
    const svg = document.getElementById("analytics-heatmap");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Prepare data: count jobs by [day of week][hour]
    const counts = Array.from({length: 7}, () => Array(24).fill(0));
    jobs.forEach(job => {
      const t = window.toTs ? window.toTs(job[window.TimeRange?.field || "updated_at"]) : Date.parse(job[window.TimeRange?.field || "updated_at"]);
      if (!Number.isFinite(t)) return;
      const date = new Date(t);
      const day = date.getDay(); // 0=Sun
      const hour = date.getHours();
      counts[day][hour]++;
    });
  const svgWidth = svg.clientWidth || 720;
  const width = svgWidth, height = 220, margin = {top: 28, right: 24, bottom: 24, left: 44};
  const cellW = (width - margin.left - margin.right) / 24;
  const cellH = (height - margin.top - margin.bottom) / 7;
    // Find max for color scale
    const maxCount = Math.max(1, ...counts.flat());
  // Color scale (theme-aligned: gray to green)
  const color = d3.scaleLinear().domain([0, maxCount]).range(["#e5e7eb", "#22c55e"]);
    // Draw cells
    for (let day = 0; day < 7; ++day) {
      for (let hour = 0; hour < 24; ++hour) {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", margin.left + hour * cellW);
        rect.setAttribute("y", margin.top + day * cellH);
        rect.setAttribute("width", cellW - 1);
        rect.setAttribute("height", cellH - 1);
        rect.setAttribute("fill", color(counts[day][hour]));
        rect.setAttribute("rx", 2);
        // Tooltip on hover
        rect.addEventListener("mousemove", evt => {
          let tooltip = document.getElementById("analytics-heatmap-tooltip");
          if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = "analytics-heatmap-tooltip";
            tooltip.style.position = "fixed";
            tooltip.style.pointerEvents = "none";
            tooltip.style.background = "#fff";
            tooltip.style.border = "1px solid #888";
            tooltip.style.borderRadius = "6px";
            tooltip.style.padding = "8px 12px";
            tooltip.style.fontSize = "14px";
            tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
            tooltip.style.zIndex = 1000;
            tooltip.style.display = "none";
            document.body.appendChild(tooltip);
          }
          tooltip.innerHTML = `<b>${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]} ${hour}:00</b><br>Jobs: <b>${counts[day][hour]}</b>`;
          tooltip.style.display = "block";
          tooltip.style.left = (evt.clientX + 18) + "px";
          tooltip.style.top = (evt.clientY - 10) + "px";
        });
        rect.addEventListener("mouseleave", () => {
          const tooltip = document.getElementById("analytics-heatmap-tooltip");
          if (tooltip) tooltip.style.display = "none";
        });
        svg.appendChild(rect);
      }
    }
    // Draw axes
    // Days
    for (let day = 0; day < 7; ++day) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", margin.left - 8);
      text.setAttribute("y", margin.top + day * cellH + cellH/2 + 5);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "12px");
      text.setAttribute("fill", "#64748b");
      text.textContent = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day];
      svg.appendChild(text);
    }
    // Hours
    for (let hour = 0; hour < 24; hour += 2) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", margin.left + hour * cellW + cellW/2);
      text.setAttribute("y", margin.top - 8);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "12px");
      text.setAttribute("fill", "#64748b");
      text.textContent = `${hour}:00`;
      svg.appendChild(text);
    }
  }
// D3.js stacked bar chart for Analytics tab
// This file is loaded dynamically by app.js when Analytics tab is shown
// It expects window.state.jobs to be available

(function(){
  if (window.__analytics_chart_loaded) return;
  window.__analytics_chart_loaded = true;

  function parseJobType(job) {
    // Test jobs have label job-type: test
    if (job.labels && job.labels["job-type"] === "test") return "Test Job";
    // All other jobs are Airflow Jobs
    return "Airflow Job";
  }

  function getTimeField(job) {
    // Use the same field as the time range filter
    return job[window.TimeRange?.field || "updated_at"];
  }

  function groupJobsByTime(jobs, binMinutes=60) {
    // Bin jobs by time (e.g. 1 hour bins)
    const bins = {};
    const types = ["Test Job", "Airflow Job"];
    jobs.forEach(job => {
      const t = window.toTs ? window.toTs(getTimeField(job)) : Date.parse(getTimeField(job));
      if (!Number.isFinite(t)) return;
      // Round down to bin
      const bin = Math.floor(t / (binMinutes*60*1000)) * binMinutes*60*1000;
      const type = parseJobType(job);
      if (!bins[bin]) bins[bin] = { "Test Job":0, "Airflow Job":0 };
      bins[bin][type] = (bins[bin][type]||0) + 1;
    });
    // Convert to array sorted by time
    return Object.entries(bins).map(([bin, counts]) => ({
      bin: +bin,
      ...counts
    })).sort((a,b) => a.bin - b.bin);
  }

  function renderAirflowJobStatusDonut(jobs) {
    const airflowDonut_airflowJobs = jobs.filter(job => parseJobType(job) === "Airflow Job");
    const airflowDonut_stateCounts = {};
    airflowDonut_airflowJobs.forEach(job => {
      const state = job.status || "Unknown";
      airflowDonut_stateCounts[state] = (airflowDonut_stateCounts[state] || 0) + 1;
    });
    const airflowDonut_stateKeys = Object.keys(airflowDonut_stateCounts);
    const airflowDonut_data = airflowDonut_stateKeys.map(k => airflowDonut_stateCounts[k]);
    const shouldAnimate = !deepEqual(airflowDonut_data, prevAirflowDonut);
    prevAirflowDonut = JSON.parse(JSON.stringify(airflowDonut_data));
    const svg = document.getElementById("analytics-airflowjobstatus-donut");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const airflowJobs = jobs.filter(job => parseJobType(job) === "Airflow Job");
    const stateCounts = {};
    airflowJobs.forEach(job => {
      const state = job.status || "Unknown";
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    });
    const stateKeys = Object.keys(stateCounts);
    const data = stateKeys.map(k => stateCounts[k]);
    const stateColors = stateKeys.map(k =>
      k === "FAILED" ? "#ef7f7fff" :
      k === "SUCCEEDED" ? "#A1D76A" :
      k === "RUNNING" ? "#8ebbf3ff" :
      k === "QUEUED" ? "#a2b7cfff" :
      "#1e40af"
    );
  const width = 220, height = 220, radius = 90, innerRadius = 50;
    const pie = d3.pie().sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcs = pie(data);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${width/2},${height/2})`);
    let tooltip = document.getElementById("analytics-airflowstate-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "analytics-airflowstate-tooltip";
      tooltip.style.position = "fixed";
      tooltip.style.pointerEvents = "none";
      tooltip.style.background = "#fff";
      tooltip.style.border = "1px solid #888";
      tooltip.style.borderRadius = "6px";
      tooltip.style.padding = "8px 12px";
      tooltip.style.fontSize = "14px";
      tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      tooltip.style.zIndex = 1000;
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);
    }
    arcs.forEach((d, i) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const arcTween = (t) => arc({startAngle: d.startAngle, endAngle: d.startAngle + (d.endAngle-d.startAngle)*t});
      path.setAttribute("fill", stateColors[i % stateColors.length]);
      path.setAttribute("stroke", "#fff");
      path.setAttribute("stroke-width", "2");
      let animFrame, start;
      if (shouldAnimate) {
        function animateArc(ts) {
          if (!start) start = ts;
          const progress = Math.min(1, (ts-start)/500);
          path.setAttribute("d", arcTween(progress));
          if (progress < 1) animFrame = requestAnimationFrame(animateArc);
        }
        requestAnimationFrame(animateArc);
      } else {
        path.setAttribute("d", arcTween(1));
      }
      path.addEventListener("mousemove", (evt) => {
        tooltip.innerHTML = `<b>${stateKeys[i]}</b><br>Count: <b>${data[i]}</b><br>Percent: <b>${data[i] && airflowJobs.length ? ((data[i]/airflowJobs.length*100).toFixed(1)) : 0}%</b>`;
        tooltip.style.display = "block";
        tooltip.style.left = (evt.clientX + 18) + "px";
        tooltip.style.top = (evt.clientY - 10) + "px";
      });
      path.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
      g.appendChild(path);

      // Add value label to the center of each arc
      const arcCentroid = arc.centroid(d);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", arcCentroid[0]);
      text.setAttribute("y", arcCentroid[1] + 4); // vertical centering tweak
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "1em");
      text.setAttribute("font-weight", "600");
      text.setAttribute("fill", "#222");
      text.textContent = data[i];
      g.appendChild(text);
    });
    svg.appendChild(g);
  }

  function renderTestJobStatusDonut(jobs) {
    const testDonut_testJobs = jobs.filter(job => parseJobType(job) === "Test Job");
    const testDonut_stateCounts = {};
    testDonut_testJobs.forEach(job => {
      const state = job.status || "Unknown";
      testDonut_stateCounts[state] = (testDonut_stateCounts[state] || 0) + 1;
    });
    const testDonut_stateKeys = Object.keys(testDonut_stateCounts);
    const testDonut_data = testDonut_stateKeys.map(k => testDonut_stateCounts[k]);
    const shouldAnimate = !deepEqual(testDonut_data, prevTestDonut);
    prevTestDonut = JSON.parse(JSON.stringify(testDonut_data));
    // Render legend to the right of chart
    const testLegend = document.getElementById("analytics-testjobstatus-legend");
    if (testLegend) {
      testLegend.innerHTML = "";
      const testJobs = jobs.filter(job => parseJobType(job) === "Test Job");
      const stateCounts = {};
      testJobs.forEach(job => {
        const state = job.status || "Unknown";
        stateCounts[state] = (stateCounts[state] || 0) + 1;
      });
      const stateKeys = Object.keys(stateCounts);
      // Use the same color logic as the chart arcs
      const stateColors = stateKeys.map(k =>
        k === "FAILED" ? "#f27373ff" :
        k === "SUCCEEDED" ? "#669636ff" :
        k === "RUNNING" ? "#7BC143" :
        k === "QUEUED" ? "#B7E4A0" :
        "#669636"
      );
      stateKeys.forEach((label, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.innerHTML = `<span style='display:inline-block;width:16px;height:16px;border-radius:4px;background:${stateColors[i]};margin-right:7px;'></span><span style='font-size:1em;color:#334155;'>${label}</span>`;
        testLegend.appendChild(item);
      });
    }
    // Render legend to the right of chart
    const airflowLegend = document.getElementById("analytics-airflowjobstatus-legend");
    if (airflowLegend) {
      airflowLegend.innerHTML = "";
      const airflowJobs = jobs.filter(job => parseJobType(job) === "Airflow Job");
      const stateCounts = {};
      airflowJobs.forEach(job => {
        const state = job.status || "Unknown";
        stateCounts[state] = (stateCounts[state] || 0) + 1;
      });
      const stateKeys = Object.keys(stateCounts);
      // Use the same color logic as the chart arcs
      const stateColors = stateKeys.map(k =>
        k === "FAILED" ? "#ef7f7fff" :
        k === "SUCCEEDED" ? "#A1D76A" :
        k === "RUNNING" ? "#8ebbf3ff" :
        k === "QUEUED" ? "#a2b7cfff" :
        "#1e40af"
      );
      stateKeys.forEach((label, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.innerHTML = `<span style='display:inline-block;width:16px;height:16px;border-radius:4px;background:${stateColors[i]};margin-right:7px;'></span><span style='font-size:1em;color:#334155;'>${label}</span>`;
        airflowLegend.appendChild(item);
      });
    }
    const svg = document.getElementById("analytics-testjobstatus-donut");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const testJobs = jobs.filter(job => parseJobType(job) === "Test Job");
    const stateCounts = {};
    testJobs.forEach(job => {
      const state = job.status || "Unknown";
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    });
    const stateKeys = Object.keys(stateCounts);
    const data = stateKeys.map(k => stateCounts[k]);
    const stateColors = stateKeys.map(k =>
      k === "FAILED" ? "#f27373ff" :
      k === "SUCCEEDED" ? "#669636ff" :
      k === "RUNNING" ? "#7BC143" :
      k === "QUEUED" ? "#B7E4A0" :
      "#669636"
    );
  const width = 220, height = 220, radius = 90, innerRadius = 50;
    const pie = d3.pie().sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcs = pie(data);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${width/2},${height/2})`);
    let tooltip = document.getElementById("analytics-testjobstate-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "analytics-testjobstate-tooltip";
      tooltip.style.position = "fixed";
      tooltip.style.pointerEvents = "none";
      tooltip.style.background = "#fff";
      tooltip.style.border = "1px solid #888";
      tooltip.style.borderRadius = "6px";
      tooltip.style.padding = "8px 12px";
      tooltip.style.fontSize = "14px";
      tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      tooltip.style.zIndex = 1000;
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);
    }
    arcs.forEach((d, i) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const arcTween = (t) => arc({startAngle: d.startAngle, endAngle: d.startAngle + (d.endAngle-d.startAngle)*t});
      path.setAttribute("fill", stateColors[i % stateColors.length]);
      path.setAttribute("stroke", "#fff");
      path.setAttribute("stroke-width", "2");
      let animFrame, start;
      if (shouldAnimate) {
        function animateArc(ts) {
          if (!start) start = ts;
          const progress = Math.min(1, (ts-start)/500);
          path.setAttribute("d", arcTween(progress));
          if (progress < 1) animFrame = requestAnimationFrame(animateArc);
        }
        requestAnimationFrame(animateArc);
      } else {
        path.setAttribute("d", arcTween(1));
      }
      path.addEventListener("mousemove", (evt) => {
        tooltip.innerHTML = `<b>${stateKeys[i]}</b><br>Count: <b>${data[i]}</b><br>Percent: <b>${data[i] && testJobs.length ? ((data[i]/testJobs.length*100).toFixed(1)) : 0}%</b>`;
        tooltip.style.display = "block";
        tooltip.style.left = (evt.clientX + 18) + "px";
        tooltip.style.top = (evt.clientY - 10) + "px";
      });
      path.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
      g.appendChild(path);

      // Add value label to the center of each arc
      const arcCentroid = arc.centroid(d);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", arcCentroid[0]);
      text.setAttribute("y", arcCentroid[1] + 4); // vertical centering tweak
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "1em");
      text.setAttribute("font-weight", "600");
      text.setAttribute("fill", "#222");
      text.textContent = data[i];
      g.appendChild(text);
    });
    svg.appendChild(g);
  }

  function renderJobTypeDonut(jobs) {
    let jobTypeDonut_testCount = 0, jobTypeDonut_airflowCount = 0;
    jobs.forEach(job => {
      const type = parseJobType(job);
      if (type === "Test Job") jobTypeDonut_testCount++;
      else jobTypeDonut_airflowCount++;
    });
    const jobTypeDonut_data = [jobTypeDonut_testCount, jobTypeDonut_airflowCount];
    const shouldAnimate = !deepEqual(jobTypeDonut_data, prevJobTypeDonut);
    prevJobTypeDonut = JSON.parse(JSON.stringify(jobTypeDonut_data));
    const svg = document.getElementById("analytics-jobtype-donut");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Render legend below chart
    const legend = document.getElementById("analytics-jobtype-legend");
    if (legend) {
      legend.innerHTML = "";
      const colors = ["#669636ff", "#A1D76A"];
      const labels = ["Test Job", "Airflow Job"];
      labels.forEach((label, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.innerHTML = `<span style='display:inline-block;width:16px;height:16px;border-radius:4px;background:${colors[i]};margin-right:7px;'></span><span style='font-size:1em;color:#334155;'>${label}</span>`;
        legend.appendChild(item);
      });
    }
    let testCount = 0, airflowCount = 0;
    jobs.forEach(job => {
      const type = parseJobType(job);
      if (type === "Test Job") testCount++;
      else airflowCount++;
    });
    const data = [testCount, airflowCount];
    const colors = ["#669636ff", "#A1D76A"];
    const labels = ["Test Job", "Airflow Job"];
  const width = 220, height = 220, radius = 90, innerRadius = 50;
    const pie = d3.pie().sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcs = pie(data);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${width/2},${height/2})`);
    let tooltip = document.getElementById("analytics-doughnut-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "analytics-doughnut-tooltip";
      tooltip.style.position = "fixed";
      tooltip.style.pointerEvents = "none";
      tooltip.style.background = "#fff";
      tooltip.style.border = "1px solid #888";
      tooltip.style.borderRadius = "6px";
      tooltip.style.padding = "8px 12px";
      tooltip.style.fontSize = "14px";
      tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      tooltip.style.zIndex = 1000;
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);
    }
    arcs.forEach((d, i) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const arcTween = (t) => arc({startAngle: d.startAngle, endAngle: d.startAngle + (d.endAngle-d.startAngle)*t});
      path.setAttribute("fill", colors[i]);
      path.setAttribute("stroke", "#fff");
      path.setAttribute("stroke-width", "2");
      let animFrame, start;
      if (shouldAnimate) {
        function animateArc(ts) {
          if (!start) start = ts;
          const progress = Math.min(1, (ts-start)/500);
          path.setAttribute("d", arcTween(progress));
          if (progress < 1) animFrame = requestAnimationFrame(animateArc);
        }
        requestAnimationFrame(animateArc);
      } else {
        path.setAttribute("d", arcTween(1));
      }
      path.addEventListener("mousemove", (evt) => {
        tooltip.innerHTML = `<b>${labels[i]}</b><br>Count: <b>${data[i]}</b><br>Percent: <b>${data[i] && (data[0]+data[1]) ? ((data[i]/(data[0]+data[1])*100).toFixed(1)) : 0}%</b>`;
        tooltip.style.display = "block";
        tooltip.style.left = (evt.clientX + 18) + "px";
        tooltip.style.top = (evt.clientY - 10) + "px";
      });
      path.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
      g.appendChild(path);
    });
    // Add split values in the center of the doughnut
    const valueTest = document.createElementNS("http://www.w3.org/2000/svg", "text");
    valueTest.setAttribute("x", "0");
    valueTest.setAttribute("y", "-2");
    valueTest.setAttribute("text-anchor", "middle");
    valueTest.setAttribute("font-size", "1.1em");
    valueTest.setAttribute("font-weight", "700");
    valueTest.setAttribute("fill", "#669636");
    valueTest.textContent = testCount;
    g.appendChild(valueTest);
    const valueAirflow = document.createElementNS("http://www.w3.org/2000/svg", "text");
    valueAirflow.setAttribute("x", "0");
    valueAirflow.setAttribute("y", "18");
    valueAirflow.setAttribute("text-anchor", "middle");
    valueAirflow.setAttribute("font-size", "1.1em");
    valueAirflow.setAttribute("font-weight", "700");
    valueAirflow.setAttribute("fill", "#A1D76A");
    valueAirflow.textContent = airflowCount;
    g.appendChild(valueAirflow);
    svg.appendChild(g);
  }

  // Store previous data for change detection
  let prevStackedBarData = null;
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a || {}), kb = Object.keys(b || {});
      if (ka.length !== kb.length) return false;
      for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
      return true;
    }
    return false;
  }

  function renderStackedBarChart(jobs, opts={}) {
    const container = document.getElementById("analytics-chart");
    if (!container) return;
    container.innerHTML = "";
    const legendWidth = 160;
    const width = Math.max((container.offsetWidth || 900) - legendWidth, 400);
    const height = container.offsetHeight || 420;
    const margin = {top: 30, right: 30, bottom: 80, left: 60};
    const totalBox = document.getElementById("analytics-total-number");
    if (totalBox) {
      totalBox.textContent = jobs.length;
    }
    const binMinutes = opts.binMinutes || 60;
  const data = groupJobsByTime(jobs, binMinutes);
  // Only animate if data changed
  const shouldAnimate = !deepEqual(data, prevStackedBarData);
  prevStackedBarData = JSON.parse(JSON.stringify(data));
    const keys = ["Test Job", "Airflow Job"];
    if (!data.length) {
      container.innerHTML = '<div style="color:#888;text-align:center;padding:2em;font-size:1.2em">No jobs to display for the selected time range.</div>';
      return;
    }
    const svg = d3.select(container)
      .append("svg")
      .attr("width", width + legendWidth)
      .attr("height", height);
    const x = d3.scaleBand()
      .domain(data.map(d => d.bin))
      .range([margin.left, width - margin.right])
      .padding(0.15);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => keys.reduce((sum, k) => sum + d[k], 0)) || 1])
      .nice()
      .range([height - margin.bottom, margin.top]);
    const color = d3.scaleOrdinal()
      .domain(keys)
      .range(["#669636ff", "#A1D76A"]);
    const stacked = d3.stack().keys(keys)(data);
    const tz = (typeof window.TZ === 'string' && window.TZ) ? window.TZ : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateFmt = (d) => {
      try {
        return new Intl.DateTimeFormat(undefined, {
          timeZone: tz,
          hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit'
        }).format(new Date(+d));
      } catch {
        return new Date(+d).toLocaleString();
      }
    };
    const xAxis = svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x)
        .tickValues(x.domain().filter((d, i) => i % Math.ceil(x.domain().length / 8) === 0))
        .tickFormat(bin => dateFmt(bin))
      );
    xAxis.selectAll("text")
      .attr("transform", "rotate(-30)")
      .style("text-anchor", "end");
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));
    const barGroups = svg.selectAll(".serie")
      .data(stacked)
      .join("g")
      .attr("fill", d => color(d.key));
    let tooltip = d3.select(container).select(".d3-tooltip");
    if (tooltip.empty()) {
      tooltip = d3.select(container)
        .append("div")
        .attr("class", "d3-tooltip")
        .style("position", "absolute")
        .style("pointer-events", "none")
        .style("background", "#fff")
        .style("border", "1px solid #888")
        .style("border-radius", "6px")
        .style("padding", "8px 12px")
        .style("font-size", "14px")
        .style("box-shadow", "0 2px 8px rgba(0,0,0,0.12)")
        .style("z-index", 10)
        .style("display", "none");
    }
    svg.selectAll(".bar-hover-area")
      .data(data)
      .join("rect")
      .attr("class", "bar-hover-area")
      .attr("x", d => x(d.bin))
      .attr("y", margin.top)
      .attr("width", x.bandwidth())
      .attr("height", height - margin.top - margin.bottom)
      .attr("fill", "transparent")
      .on("mousemove", function(event, d) {
        svg.selectAll(".bar-rect").attr("opacity", 0.5);
        d3.select(this).attr("fill", "#bae6fd");
        const timeStr = dateFmt(d.bin);
        const total = (d["Test Job"] || 0) + (d["Airflow Job"] || 0);
        tooltip.html(
          `<div><b>${timeStr}</b></div>`+
          `<div>Total: <b>${total}</b></div>`+
          `<div style='color:${color("Test Job")};'>Test Job: ${d["Test Job"] || 0}</div>`+
          `<div style='color:${color("Airflow Job")};'>Airflow Job: ${d["Airflow Job"] || 0}</div>`
        )
        .style("display", "block")
        .style("left", (event.clientX + 18) + "px")
        .style("top", (event.clientY + 10) + "px");
      })
      .on("mouseleave", function() {
        svg.selectAll(".bar-rect").attr("opacity", 1);
        d3.select(this).attr("fill", "transparent");
        tooltip.style("display", "none");
      });
    // Animated bars: grow from zero height
    const bars = barGroups.selectAll("rect")
      .data(d => d)
      .join("rect")
      .attr("class", "bar-rect")
      .attr("x", d => x(d.data.bin))
      .attr("width", x.bandwidth());
    if (shouldAnimate) {
      bars
        .attr("y", y(0))
        .attr("height", 0)
        .transition()
        .duration(900)
        .attr("y", d => y(d[1]))
        .attr("height", d => y(d[0]) - y(d[1]));
    } else {
      bars
        .attr("y", d => y(d[1]))
        .attr("height", d => y(d[0]) - y(d[1]));
    }
    const legend = svg.append("g")
      .attr("transform", `translate(${width + 40},${margin.top + 40})`);
    keys.forEach((k, i) => {
      legend.append("rect")
        .attr("x", 0)
        .attr("y", i * 32)
        .attr("width", 18)
        .attr("height", 18)
        .attr("fill", color(k));
      legend.append("text")
        .attr("x", 26)
        .attr("y", i * 32 + 13)
        .text(k)
        .style("font-size", "14px");
    });
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", margin.left/3)
      .attr("x", 0 - height/2)
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .text("Number of Jobs");
  }

  // Expose to window

  function renderTotalJobGauge(jobs) {
  const svg = document.getElementById("analytics-total-gauge");
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const total = jobs.length;
  const width = 180, height = 120;
  // Center the number both vertically and horizontally
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", width/2);
  text.setAttribute("y", height/2);
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("alignment-baseline", "middle");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "3em");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", "#222933");
  text.textContent = total;
  svg.appendChild(text);
  }

  function renderSuccessRateGauge(jobs) {
  const svg = document.getElementById("analytics-success-gauge");
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const total = jobs.length;
  const succeeded = jobs.filter(j => j.status === "SUCCEEDED").length;
  const rate = total ? succeeded / total : 0;
  const percent = Math.round(rate * 100);
  const width = 180, height = 120;
  // Only show the percent number, centered, in green
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", width/2);
  text.setAttribute("y", height/2);
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("alignment-baseline", "middle");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "2.8em");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", "#22c55e");
  text.textContent = percent + "%";
  svg.appendChild(text);
  }

  window.renderAnalyticsChart = function(jobs, opts = {}) {
    // If opts.animate is true, reset previous data so all charts animate
    if (opts.animate) {
      prevDualGauge = null;
      prevJobsHeatmap = null;
      prevAirflowDonut = null;
      prevTestDonut = null;
      prevJobTypeDonut = null;
      prevStackedBarData = null;
    }
    renderStackedBarChart(jobs || [], {binMinutes: 60});
    renderDualGauge(jobs || []);
    renderJobsHeatmap(jobs || []);
    renderJobTypeDonut(jobs || []);
    renderTestJobStatusDonut(jobs || []);
    renderAirflowJobStatusDonut(jobs || []);
  };
})();
