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

  function renderStackedBarChart(jobs, opts={}) {
    // --- Doughnut chart for job type distribution ---
    const doughnutSvg = document.getElementById("analytics-doughnut-chart");
    if (doughnutSvg) {
      // Clear previous chart
      while (doughnutSvg.firstChild) doughnutSvg.removeChild(doughnutSvg.firstChild);
      // Remove any previous legend or label
      const legend = document.getElementById("analytics-doughnut-legend");
      if (legend && legend.parentElement) legend.parentElement.removeChild(legend);
      const label = document.getElementById("analytics-doughnut-label");
      if (label && label.parentElement) label.parentElement.removeChild(label);

      // Count jobs by type
      let testCount = 0, airflowCount = 0;
      jobs.forEach(job => {
        const type = parseJobType(job);
        if (type === "Test Job") testCount++;
        else airflowCount++;
      });
      const data = [testCount, airflowCount];
      const colors = ["#669636ff", "#A1D76A"];
      const labels = ["Test Job", "Airflow Job"];
      const width = 120, height = 120, radius = 54, innerRadius = 32;
      const pie = d3.pie().sort(null);
      const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
      const arcs = pie(data);
      // Center group for arcs
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("transform", `translate(${width/2},${height/2})`);

      // Tooltip div (HTML, not SVG)
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
        // Animate the arc drawing
        const arcTween = (t) => arc({startAngle: d.startAngle, endAngle: d.startAngle + (d.endAngle-d.startAngle)*t});
        path.setAttribute("fill", colors[i]);
        path.setAttribute("stroke", "#fff");
        path.setAttribute("stroke-width", "2");
        // Animation
        let animFrame, start;
        function animateArc(ts) {
          if (!start) start = ts;
          const progress = Math.min(1, (ts-start)/500); // 500ms
          path.setAttribute("d", arcTween(progress));
          if (progress < 1) animFrame = requestAnimationFrame(animateArc);
        }
        requestAnimationFrame(animateArc);

        // Interactivity: tooltip
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

      doughnutSvg.appendChild(g);
    }
    const container = document.getElementById("analytics-chart");
    if (!container) return;
    container.innerHTML = "";
    // Shrink chart width to leave space for legend
    const legendWidth = 160;
    const width = Math.max((container.offsetWidth || 900) - legendWidth, 400);
    const height = container.offsetHeight || 420;
    const margin = {top: 30, right: 30, bottom: 80, left: 60};

    // Update total jobs box below chart
    const totalBox = document.getElementById("analytics-total-number");
    if (totalBox) {
      totalBox.textContent = jobs.length;
    }
    // Bin jobs by time
    const binMinutes = opts.binMinutes || 60;
    const data = groupJobsByTime(jobs, binMinutes);
  const keys = ["Test Job", "Airflow Job"];
    if (!data.length) {
      container.innerHTML = '<div style="color:#888;text-align:center;padding:2em;font-size:1.2em">No jobs to display for the selected time range.</div>';
      return;
    }
    const svg = d3.select(container)
      .append("svg")
      .attr("width", width + legendWidth)
      .attr("height", height);
    // X: time bins
    const x = d3.scaleBand()
      .domain(data.map(d => d.bin))
      .range([margin.left, width - margin.right])
      .padding(0.15);
    // Y: count
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => keys.reduce((sum, k) => sum + d[k], 0)) || 1])
      .nice()
      .range([height - margin.bottom, margin.top]);
    // Color
    // Use Tailwind theme colors: blue-600 for Test Job, green-600 for Airflow Job
    const color = d3.scaleOrdinal()
      .domain(keys)
      .range(["#669636ff", "#A1D76A"]); 
    // Stack data
    const stacked = d3.stack().keys(keys)(data);
    // Use selected TZ for all date/times
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
    // X axis with reduced ticks
    const xAxis = svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x)
        .tickValues(x.domain().filter((d, i) => i % Math.ceil(x.domain().length / 8) === 0))
        .tickFormat(bin => dateFmt(bin))
      );
    xAxis.selectAll("text")
      .attr("transform", "rotate(-30)")
      .style("text-anchor", "end");
    // Y axis
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));
    // Bars with interactivity
    const barGroups = svg.selectAll(".serie")
      .data(stacked)
      .join("g")
      .attr("fill", d => color(d.key));

    // Tooltip
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

    // For each bin, draw a transparent rect for hover
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
        // Highlight bar
        svg.selectAll(".bar-rect").attr("opacity", 0.5);
        d3.select(this).attr("fill", "#bae6fd");
        // Tooltip content with legend-matching colors
        const timeStr = dateFmt(d.bin);
        const total = (d["Test Job"] || 0) + (d["Airflow Job"] || 0);
        tooltip.html(
          `<div><b>${timeStr}</b></div>`+
          `<div>Total: <b>${total}</b></div>`+
          `<div style='color:${color("Test Job")};'>Test Job: ${d["Test Job"] || 0}</div>`+
          `<div style='color:${color("Airflow Job")};'>Airflow Job: ${d["Airflow Job"] || 0}</div>`
        )
        .style("display", "block")
        .style("left", (event.offsetX + 30) + "px")
        .style("top", (event.offsetY + 10) + "px");
      })
      .on("mouseleave", function() {
        svg.selectAll(".bar-rect").attr("opacity", 1);
        d3.select(this).attr("fill", "transparent");
        tooltip.style("display", "none");
      });

    // Draw the actual bars
    barGroups.selectAll("rect")
      .data(d => d)
      .join("rect")
      .attr("class", "bar-rect")
      .attr("x", d => x(d.data.bin))
      .attr("y", d => y(d[1]))
      .attr("height", d => y(d[0]) - y(d[1]))
      .attr("width", x.bandwidth());
    // Legend at the right of the chart, vertically centered
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
    // Y axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", margin.left/3)
      .attr("x", 0 - height/2)
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .text("Number of Jobs");
  // (Removed X axis label)
  }

  // Expose to window
  window.renderAnalyticsChart = function(jobs) {
    renderStackedBarChart(jobs || [], {binMinutes: 60});
  };
})();
