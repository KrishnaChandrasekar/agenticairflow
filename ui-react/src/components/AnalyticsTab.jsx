import { useEffect, useRef, useState, useCallback } from 'react';
import { toTs } from '../utils/api';

// Ensure toTs is available globally for time filtering
if (typeof window !== 'undefined') {
  window.toTs = toTs;
}

// Simple deep equality check
const deepEqual = (obj1, obj2) => {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return obj1 === obj2;
  
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  for (let key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) return false;
  }
  
  return true;
};

const AnalyticsTab = ({ jobs, filterJobsByTime, autoRefresh, timezone }) => {
  const chartRef = useRef(null);
  const gaugeRef = useRef(null);
  const heatmapRef = useRef(null);
  const jobTypeDonutRef = useRef(null);
  const testJobDonutRef = useRef(null);
  const airflowJobDonutRef = useRef(null);
  const jobTypeLegendRef = useRef(null);
  const testJobLegendRef = useRef(null);
  const airflowJobLegendRef = useRef(null);

  const [d3Loaded, setD3Loaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prevData, setPrevData] = useState({ dualGauge: null });

  // Parse job type helper
  const parseJobType = useCallback((job) => {
    if (job.labels && job.labels["job-type"] === "test") return "Test Job";
    return "Airflow Job";
  }, []);

  // Load D3.js
  useEffect(() => {
    if (typeof window !== 'undefined' && window.d3) {
      setD3Loaded(true);
      setLoading(false);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://d3js.org/d3.v7.min.js';
    script.async = true;
    script.onload = () => {
      setD3Loaded(true);
      setLoading(false);
    };
    script.onerror = () => {
      console.error('Failed to load D3.js');
      setError('Failed to load visualization library');
      setLoading(false);
    };
    document.head.appendChild(script);

    return () => {
      const existingScript = document.querySelector('script[src="https://d3js.org/d3.v7.min.js"]');
      if (existingScript) {
        document.head.removeChild(existingScript);
      }
    };
  }, []);

  // Helper for Job Type Summary
  const renderJobTypeSummary = useCallback((jobs) => {
    const container = jobTypeLegendRef.current;
    if (!container) return;

    const testJobs = jobs.filter(j => parseJobType(j) === "Test Job").length;
    const airflowJobs = jobs.filter(j => parseJobType(j) === "Airflow Job").length;

    if (testJobs === 0 && airflowJobs === 0) {
      container.innerHTML = `
        <div class="bg-gray-50 rounded-lg p-4 text-center">
          <div class="text-gray-500 text-sm">No jobs to display</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="bg-white rounded-lg p-4 border border-gray-200">
          <div class="text-lg font-semibold text-gray-800 mb-3">Job Type Summary</div>
          <div class="space-y-2">
            <span class="text-sm">Test Jobs: ${testJobs}</span>
            <br>
            <span class="text-sm">Airflow Jobs: ${airflowJobs}</span>
          </div>
        </div>
      `;
    }

  }, [parseJobType]);

  // Modern Gauge Chart
  const renderModernGauge = useCallback((jobs) => {
    if (!gaugeRef.current) return;
    
    // EXPLICIT EMPTY STATE HANDLING
    if (jobs.length === 0) {
      const container = gaugeRef.current;
      container.innerHTML = `
        <div class="modern-gauge-container" style="position: relative; width: 320px; height: 180px; display: flex; align-items: center; justify-content: center; gap: 24px; font-family: system-ui, -apple-system, sans-serif;">
          <!-- Circular Progress Ring -->
          <div style="position: relative; width: 160px; height: 160px;">
            <svg width="160" height="160" viewBox="0 0 160 160" style="transform: rotate(-90deg);">
              <circle cx="80" cy="80" r="70" fill="none" stroke="#f3f4f6" stroke-width="12"></circle>
              <circle cx="80" cy="80" r="70" fill="none" stroke="#f3f4f6" stroke-width="12" stroke-dasharray="440" stroke-dashoffset="440"></circle>
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#e5e7eb;stop-opacity:1" />
                  <stop offset="100%" style="stop-color:#d1d5db;stop-opacity:1" />
                </linearGradient>
              </defs>
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
              <div style="font-size: 2.8rem; font-weight: 700; color: #9ca3af; line-height: 1; margin-bottom: 4px;">0%</div>
              <div style="font-size: 0.85rem; color: #6b7280; line-height: 1.1; font-weight: 500;">No Jobs</div>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 16px; align-items: flex-start;">
            <div style="text-align: left;">
              <div style="font-size: 1.5rem; font-weight: 700; color: #9ca3af; line-height: 1;">0</div>
              <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Total Jobs</div>
            </div>
            <div style="text-align: left;">
              <div style="font-size: 1.5rem; font-weight: 700; color: #9ca3af; line-height: 1;">0</div>
              <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Successful</div>
            </div>
            <div style="text-align: left;">
              <div style="font-size: 1.5rem; font-weight: 700; color: #9ca3af; line-height: 1;">0</div>
              <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Failed</div>
            </div>
          </div>
        </div>
      `;
      return;
    }
    
    const total = jobs.length;
    const succeeded = jobs.filter(j => j.status === "SUCCEEDED").length;
    const failed = jobs.filter(j => j.status === "FAILED").length;
    const running = jobs.filter(j => j.status === "RUNNING").length;
    const rate = total ? succeeded / total : 0;
    const percent = Math.round(rate * 100);
    
    // Use actual filtered data only
    const finalRate = rate;
    const finalPercent = percent;
    const finalTotal = total;
    
    console.log('🎯 Modern Gauge - Success Rate:', finalPercent + '%', 'of', finalTotal, 'jobs');
    
    const curData = { total: finalTotal, succeeded, percent: finalPercent };
    const shouldAnimate = !prevData.dualGauge || !deepEqual(curData, prevData.dualGauge);
    
    const container = gaugeRef.current;
    if (!container) return;
    
    // Clear and create modern gauge
    container.innerHTML = `
      <div class="modern-gauge-container" style="position: relative; width: 320px; height: 180px; display: flex; align-items: center; justify-content: center; gap: 24px; font-family: system-ui, -apple-system, sans-serif;">
        <!-- Circular Progress Ring -->
        <div style="position: relative; width: 160px; height: 160px;">
          <svg width="160" height="160" viewBox="0 0 160 160" style="transform: rotate(-90deg);">
            <!-- Background Circle -->
            <circle 
              cx="80" 
              cy="80" 
              r="70" 
              fill="none" 
              stroke="#f3f4f6" 
              stroke-width="12"
            ></circle>
            <!-- Progress Circle -->
            <circle 
              cx="80" 
              cy="80" 
              r="70" 
              fill="none" 
              stroke="url(#gradient)" 
              stroke-width="12" 
              stroke-linecap="round"
              stroke-dasharray="440"
              stroke-dashoffset="440"
              class="progress-circle"
              style="transition: stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1);"
            ></circle>
            <!-- Gradient Definition -->
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
              </linearGradient>
            </defs>
          </svg>
          
          <!-- Center Content -->
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
            <div class="gauge-percentage" style="font-size: 2.8rem; font-weight: 700; color: #1f2937; line-height: 1; margin-bottom: 4px; display: block;">0%</div>
            <div style="font-size: 0.85rem; color: #6b7280; line-height: 1.1; font-weight: 500; display: block;">Success Rate</div>
          </div>
        </div>
        
        <!-- Stats Column (Right Side) -->
        <div style="display: flex; flex-direction: column; gap: 16px; align-items: flex-start;">
          <div style="text-align: left;">
            <div class="total-jobs" style="font-size: 1.5rem; font-weight: 700; color: #1f2937; line-height: 1;">${finalTotal}</div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Total Jobs</div>
          </div>
          <div style="text-align: left;">
            <div class="successful-jobs" style="font-size: 1.5rem; font-weight: 700; color: #10b981; line-height: 1;">${succeeded}</div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Successful</div>
          </div>
          <div style="text-align: left;">
            <div class="failed-jobs" style="font-size: 1.5rem; font-weight: 700; color: #ef4444; line-height: 1;">${failed}</div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-top: 2px;">Failed</div>
          </div>
        </div>
      </div>
    `;
    
    // Animate the circular progress
    const progressCircle = container.querySelector('.progress-circle');
    const percentageText = container.querySelector('.gauge-percentage');
    
    if (!shouldAnimate) {
      // Set final values without animation
      const circumference = 2 * Math.PI * 70; // r = 70
      const offset = circumference - (finalRate * circumference);
      progressCircle.style.strokeDashoffset = offset;
      percentageText.textContent = finalPercent + "%";
      setPrevData(prev => ({ ...prev, dualGauge: curData }));
      return;
    }
    
    // Update state for next render comparison
    setPrevData(prev => ({ ...prev, dualGauge: curData }));
    
    // Smooth CSS-based animation
    console.log('🎯 Animating Modern Gauge to:', finalPercent + '%');
    
    // Start from 0
    progressCircle.style.strokeDashoffset = "440";
    percentageText.textContent = "0%";
    
    // Animate after a brief delay
    setTimeout(() => {
      const circumference = 2 * Math.PI * 70; // r = 70
      const offset = circumference - (finalRate * circumference);
      progressCircle.style.strokeDashoffset = offset;
      
      // Animate percentage counter
      let currentPercent = 0;
      const increment = finalPercent / 60; // 60 steps over 1.5 seconds
      const timer = setInterval(() => {
        currentPercent += increment;
        if (currentPercent >= finalPercent) {
          currentPercent = finalPercent;
          clearInterval(timer);
          console.log('✅ Modern Gauge Animation Complete:', finalPercent + '%');
        }
        percentageText.textContent = Math.round(currentPercent) + "%";
      }, 25);
      
    }, 100);
  }, []);

  const renderStackedBarChart = useCallback((jobs) => {
    if (!chartRef.current) {
      console.log('❌ Chart container ref not available');
      return;
    }
    
    if (!window.d3) {
      console.log('❌ D3.js not loaded yet');
      return;
    }
    
    console.log('📊 Rendering bar chart with', jobs.length, 'jobs');
    
    const container = chartRef.current;
    container.innerHTML = "";
    
    // EXPLICIT EMPTY STATE HANDLING
    if (jobs.length === 0) {
      console.log('📊 No jobs data - showing empty state');
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 200px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
            <div>No job data available for the selected time range</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Try selecting a different time period</div>
          </div>
        </div>
      `;
      return;
    }
    
    // Simple time-based grouping with automatic intervals - Changed to group by job type instead of status
    const createTimeSeriesData = (jobs) => {
      const filteredJobs = jobs;
      console.log('🔍 Processing', filteredJobs.length, 'jobs for chart data');

      // Determine optimal time interval based on data span
      const timestamps = filteredJobs.map(job => toTs(job.updated_at || job.created_at)).filter(t => Number.isFinite(t));
      console.log('📅 Valid timestamps found:', timestamps.length);
      if (!timestamps.length) {
        console.log('❌ No valid timestamps found in jobs');
        return [];
      }
      
      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);
      const timeSpan = maxTime - minTime;
      
      // Auto-select interval: 15min, 1hr, 6hr, or 1day based on span
      let intervalMs;
      if (timeSpan <= 6 * 60 * 60 * 1000) intervalMs = 15 * 60 * 1000; // 15 minutes
      else if (timeSpan <= 48 * 60 * 60 * 1000) intervalMs = 60 * 60 * 1000; // 1 hour
      else if (timeSpan <= 7 * 24 * 60 * 60 * 1000) intervalMs = 6 * 60 * 60 * 1000; // 6 hours
      else intervalMs = 24 * 60 * 60 * 1000; // 1 day

      // Create time buckets - Changed to track Test Jobs vs Airflow Jobs
      const bins = {};
      const startTime = Math.floor(minTime / intervalMs) * intervalMs;
      const endTime = Math.ceil(maxTime / intervalMs) * intervalMs;
      
      // Initialize all time buckets
      for (let time = startTime; time <= endTime; time += intervalMs) {
        bins[time] = { timestamp: new Date(time), "Test Jobs": 0, "Airflow Jobs": 0 };
      }

      // Populate buckets with job data - Group by job type instead of status
      filteredJobs.forEach(job => {
        const jobTime = toTs(job.updated_at || job.created_at);
        if (Number.isFinite(jobTime)) {
          const bucket = Math.floor(jobTime / intervalMs) * intervalMs;
          if (bins[bucket]) {
            const jobType = parseJobType(job);
            bins[bucket][jobType] = (bins[bucket][jobType] || 0) + 1;
          }
        }
      });

      const result = Object.values(bins).sort((a, b) => a.timestamp - b.timestamp);
      console.log('📊 Chart data created:', result.length, 'time bins');
      return result;
    };
    
    const data = createTimeSeriesData(jobs);
    
    if (data.length === 0) {
      console.log('❌ No chart data created - showing empty state');
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 200px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
            <div>Unable to process job data for chart</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Check if jobs have valid timestamps</div>
          </div>
        </div>
      `;
      return;
    }
    
    // Get container dimensions with padding consideration
    const containerRect = container.getBoundingClientRect();
    const containerWidth = Math.max(500, (containerRect.width || 800) - 20); // Increased minimum width
    const containerHeight = Math.max(250, (containerRect.height || 300) - 10); // Account for padding
    
    console.log('📐 Chart dimensions:', { containerWidth, containerHeight, rectWidth: containerRect.width });
    
    const margin = { top: 20, right: 20, bottom: 70, left: 50 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;
    
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("background", "transparent")
      .style("display", "block")
      .style("max-width", "100%")
      .style("height", "100%");
      
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Time-based scales
    const xTimeScale = window.d3.scaleTime()
      .domain(window.d3.extent(data, d => d.timestamp))
      .range([0, width]);
      
    // Fixed bar width calculation - make bars narrower to prevent Y-axis overlap
    const maxBarWidth = 40; // Maximum bar width
    const calculatedBarWidth = (width / data.length) * 0.6; // Reduced from 0.8 to 0.6
    const barWidth = Math.max(8, Math.min(maxBarWidth, calculatedBarWidth)); // Minimum 8px, maximum 40px
      
    const y = window.d3.scaleLinear()
      .domain([0, window.d3.max(data, d => d["Test Jobs"] + d["Airflow Jobs"])])
      .range([height, 0]);
    
    // Stack generator - Changed to use job types
    const stack = window.d3.stack()
      .keys(["Test Jobs", "Airflow Jobs"]);
      
    const series = stack(data);
    
    // Updated color scale for job types (using green theme)
    const color = window.d3.scaleOrdinal()
      .domain(["Test Jobs", "Airflow Jobs"])
      .range(["#3b82f6", "#22c55e"]); // Blue for Test Jobs, Green for Airflow Jobs
    
    // Simple grid lines (like original UI)
    const yGrid = window.d3.axisLeft(y)
      .tickSize(-width)
      .tickFormat("");
    
    g.append("g")
      .attr("class", "grid")
      .style("opacity", 0.3)
      .style("stroke", "#e5e7eb")
      .call(yGrid);

    // Simple white tooltip (like original UI)
    const tooltip = window.d3.select(container)
      .append("div")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background", "#fff")
      .style("color", "#334155")
      .style("padding", "8px 12px")
      .style("border-radius", "6px")
      .style("font-size", "14px")
      .style("box-shadow", "0 2px 8px rgba(0,0,0,0.12)")
      .style("border", "1px solid #888")
      .style("pointer-events", "none")
      .style("z-index", "1000");

    // Draw time-series bars
    g.selectAll(".serie")
      .data(series)
      .enter().append("g")
      .attr("class", "serie")
      .attr("fill", d => color(d.key))
      .selectAll("rect")
      .data(d => d)
      .enter().append("rect")
      .attr("x", d => xTimeScale(d.data.timestamp) - barWidth / 2)
      .attr("y", d => y(d[1]))
      .attr("height", d => y(d[0]) - y(d[1]))
      .attr("width", barWidth)
      .style("opacity", 0.9)
      .on("mouseover", function(event, d) {
        const jobType = window.d3.select(this.parentNode).datum().key;
        const count = d[1] - d[0];
        const date = d.data.timestamp;
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const dateStr = `${date.getDate()}-${monthNames[date.getMonth()]}-${date.getFullYear()}`;
        const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const total = d.data["Test Jobs"] + d.data["Airflow Jobs"];
        
        tooltip.transition().duration(200).style("opacity", .9);
        tooltip.html(`<b>${dateStr} ${timeStr}</b><br>${jobType}: <b>${count}</b><br>Total: <b>${total}</b>`)
          .style("left", (event.pageX + 18) + "px")
          .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseout", function() {
        tooltip.transition().duration(500).style("opacity", 0);
      });
    
    // Time-based X axis with smart formatting
    const timeRange = window.d3.extent(data, d => d.timestamp);
    const timeSpan = timeRange[1] - timeRange[0];
    
    let timeFormat;
    let tickInterval;
    if (timeSpan <= 6 * 60 * 60 * 1000) { // Less than 6 hours
      timeFormat = window.d3.timeFormat("%H:%M");
      tickInterval = window.d3.timeMinute.every(30);
    } else if (timeSpan <= 2 * 24 * 60 * 60 * 1000) { // Less than 2 days
      timeFormat = window.d3.timeFormat("%d %b %H:%M");
      tickInterval = window.d3.timeHour.every(4);
    } else if (timeSpan <= 7 * 24 * 60 * 60 * 1000) { // Less than 7 days
      timeFormat = window.d3.timeFormat("%d-%b");
      tickInterval = window.d3.timeDay.every(1);
    } else {
      timeFormat = window.d3.timeFormat("%d-%b-%Y");
      tickInterval = window.d3.timeDay.every(Math.ceil(timeSpan / (7 * 24 * 60 * 60 * 1000)));
    }
    
    const xAxis = window.d3.axisBottom(xTimeScale)
      .ticks(tickInterval)
      .tickFormat(timeFormat);
    
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .selectAll("text")
      .style("text-anchor", "end")
      .attr("dx", "-.8em")
      .attr("dy", ".15em")
      .attr("transform", "rotate(-45)");
    
    // Y axis
    g.append("g")
      .call(window.d3.axisLeft(y));
    
    // Legend - Updated for job types
    const legend = g.selectAll(".legend")
      .data(color.domain().slice())
      .enter().append("g")
      .attr("class", "legend")
      .attr("transform", (d, i) => `translate(${width - 120},${i * 20})`);
      
    legend.append("rect")
      .attr("x", 0)
      .attr("width", 18)
      .attr("height", 18)
      .style("fill", color);
      
    legend.append("text")
      .attr("x", 24)
      .attr("y", 9)
      .attr("dy", "0.35em")
      .style("text-anchor", "start")
      .style("font-size", "12px")
      .text(d => d);
      
  }, [parseJobType]);

  const renderHeatmap = useCallback((jobs) => {
    if (!heatmapRef.current || !window.d3) return;
    
    const container = heatmapRef.current;
    container.innerHTML = "";
    
    // EXPLICIT EMPTY STATE HANDLING
    if (jobs.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 288px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">🔥</div>
            <div>No activity data available</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Jobs will appear here when they match your time filter</div>
          </div>
        </div>
      `;
      return;
    }
    
    // Process data for heatmap (hour of day vs day of week)
    const processData = (jobs) => {
      const data = [];
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      
      const counts = {};
      const activeCells = new Set();
      
      jobs.forEach(job => {
        const date = new Date(job.created_at || job.updated_at);
        const day = date.getDay();
        const hour = date.getHours();
        const key = `${day}-${hour}`;
        counts[key] = (counts[key] || 0) + 1;
        activeCells.add(key);
      });
      
      // If very few jobs (< 10), only show a focused view around active cells
      if (jobs.length < 10 && activeCells.size > 0) {
        const activeHours = new Set();
        const activeDays = new Set();
        
        for (const key of activeCells) {
          const [day, hour] = key.split('-').map(Number);
          activeDays.add(day);
          activeHours.add(hour);
        }
        
        // Create a focused grid around active areas
        const minHour = Math.max(0, Math.min(...activeHours) - 2);
        const maxHour = Math.min(23, Math.max(...activeHours) + 2);
        const minDay = Math.max(0, Math.min(...activeDays) - 1);
        const maxDay = Math.min(6, Math.max(...activeDays) + 1);
        
        for (let day = minDay; day <= maxDay; day++) {
          for (let hour = minHour; hour <= maxHour; hour++) {
            data.push({
              day: day,
              hour: hour,
              value: counts[`${day}-${hour}`] || 0
            });
          }
        }
      } else {
        // For more jobs, show full grid
        for (let day = 0; day < 7; day++) {
          for (let hour = 0; hour < 24; hour++) {
            data.push({
              day: day,
              hour: hour,
              value: counts[`${day}-${hour}`] || 0
            });
          }
        }
      }
      
      return data;
    };
    
    const data = processData(jobs);
    const maxValue = window.d3.max(data, d => d.value);
    
    // Get container dimensions and calculate responsive sizes
    const containerRect = container.getBoundingClientRect();
    const margin = { top: 45, right: 40, bottom: 30, left: 80 };
    const availableWidth = Math.max(containerRect.width - margin.left - margin.right, 600);
    const availableHeight = Math.max(containerRect.height - margin.top - margin.bottom, 150);
    
    // Calculate dimensions based on actual data range
    const uniqueHours = [...new Set(data.map(d => d.hour))];
    const uniqueDays = [...new Set(data.map(d => d.day))];
    const hoursRange = uniqueHours.length;
    const daysRange = uniqueDays.length;
    
    // Prioritize horizontal stretching - adjust for actual data range
    const cellWidth = availableWidth / (hoursRange || 24);
    const cellHeight = Math.min(availableHeight / (daysRange || 7), cellWidth * 0.6);
    
    const actualCellWidth = cellWidth;
    const actualCellHeight = cellHeight;
    
    // Actual chart dimensions based on data range
    const width = actualCellWidth * (hoursRange || 24);
    const height = actualCellHeight * (daysRange || 7);
    
    // Create responsive SVG that fills the container
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
      
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Color scale (original UI theme: gray to green)
    const color = window.d3.scaleLinear()
      .domain([0, maxValue || 10])
      .range(["#e5e7eb", "#22c55e"]);
    
    // Calculate position mapping for focused grids
    const minHour = Math.min(...uniqueHours);
    const minDay = Math.min(...uniqueDays);
    
    // Draw cells with responsive sizing - stretch horizontally
    g.selectAll(".cell")
      .data(data)
      .enter().append("rect")
      .attr("class", "cell")
      .attr("x", d => (d.hour - minHour) * actualCellWidth)
      .attr("y", d => (d.day - minDay) * actualCellHeight)
      .attr("width", actualCellWidth * 0.95) // Maximize width usage
      .attr("height", actualCellHeight * 0.9)
      .attr("rx", 3) // Slightly larger rounded corners for stretched cells
      .attr("fill", d => color(d.value))
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        // Add tooltip on hover
        const tooltip = window.d3.select("body").append("div")
          .attr("class", "heatmap-tooltip")
          .style("position", "absolute")
          .style("background", "rgba(0,0,0,0.8)")
          .style("color", "white")
          .style("padding", "8px")
          .style("border-radius", "4px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("z-index", "1000");
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        tooltip.html(`${days[d.day]} ${d.hour}:00<br/>${d.value} jobs`)
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseout", function() {
        window.d3.selectAll(".heatmap-tooltip").remove();
      });
    
    // Add day labels with responsive font size
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fontSize = Math.max(Math.min(actualCellHeight * 0.6, 14), 10);
    
    g.selectAll(".day-label")
      .data(days)
      .enter().append("text")
      .attr("class", "day-label")
      .attr("x", -10)
      .attr("y", (d, i) => i * actualCellHeight + actualCellHeight / 2)
      .attr("dy", "0.35em")
      .style("text-anchor", "end")
      .style("font-size", fontSize + "px")
      .style("font-weight", "500")
      .style("fill", "#4b5563")
      .text(d => d);
    
    // Add hour labels with responsive positioning - more labels for wider layout
    const hourLabels = actualCellWidth > 25 ? 
      window.d3.range(0, 24, 2) : // Every 2 hours if cells are wide enough
      window.d3.range(0, 24, 3);  // Every 3 hours if cells are narrow
      
    g.selectAll(".hour-label")
      .data(hourLabels)
      .enter().append("text")
      .attr("class", "hour-label")
      .attr("x", d => d * actualCellWidth + actualCellWidth / 2)
      .attr("y", -15)
      .style("text-anchor", "middle")
      .style("font-size", Math.min(fontSize, 12) + "px")
      .style("font-weight", "500")
      .style("fill", "#4b5563")
      .text(d => `${d}:00`);
      
  }, []);

  const renderDonutChart = useCallback((jobs, containerRef, title, filterFn) => {
    if (!containerRef.current || !window.d3) return;
    
    const container = containerRef.current;
    container.innerHTML = "";
    
    const filteredJobs = filterFn ? jobs.filter(filterFn) : jobs;
    
    if (!filteredJobs.length) {
      container.innerHTML = `
        <div class="flex items-center justify-center h-48 text-gray-500">
          No ${title.toLowerCase()} to display
        </div>
      `;
      return;
    }
    
    // Count by status
    const statusCounts = filteredJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    
    const data = Object.entries(statusCounts).map(([key, value]) => ({
      label: key,
      value: value
    }));
    
    const width = 200;
    const height = 200;
    const radius = Math.min(width, height) / 2;
    
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height);
      
    const g = svg.append("g")
      .attr("transform", `translate(${width/2},${height/2})`);
    
    // Color scale (match original UI)
    const color = window.d3.scaleOrdinal()
      .domain(["SUCCEEDED", "FAILED", "RUNNING"])
      .range(["#22c55e", "#ef4444", "#f59e0b"]);
    
    // Pie generator
    const pie = window.d3.pie()
      .value(d => d.value);
      
    // Arc generator
    const arc = window.d3.arc()
      .innerRadius(radius * 0.4)
      .outerRadius(radius * 0.8);
    
    // Draw arcs
    const arcs = g.selectAll(".arc")
      .data(pie(data))
      .enter().append("g")
      .attr("class", "arc");
      
    arcs.append("path")
      .attr("d", arc)
      .attr("fill", d => color(d.data.label));
    
    // Add labels
    arcs.append("text")
      .attr("transform", d => `translate(${arc.centroid(d)})`)
      .attr("dy", "0.35em")
      .style("text-anchor", "middle")
      .style("font-size", "12px")
      .style("font-weight", "bold")
      .style("fill", "white")
      .text(d => d.data.value);
      
  }, []);

  const renderLegend = useCallback((jobs, containerRef, title, filterFn) => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const filteredJobs = filterFn ? jobs.filter(filterFn) : jobs;
    
    if (!filteredJobs.length) {
      container.innerHTML = `
        <div class="text-center text-gray-500 py-4">
          No ${title.toLowerCase()} to display
        </div>
      `;
      return;
    }
    
    const statusCounts = filteredJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    
    const colors = {
      'SUCCEEDED': '#22c55e',
      'FAILED': '#ef4444', 
      'RUNNING': '#f59e0b'
    };
    
    const legendItems = Object.entries(statusCounts).map(([status, count]) => `
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <div class="w-3 h-3 rounded-full mr-2" style="background-color: ${colors[status]}"></div>
          <span class="text-sm">${status}</span>
        </div>
        <span class="text-sm font-medium">${count}</span>
      </div>
    `).join('');
    
    container.innerHTML = `
      <div class="bg-white rounded-lg p-4 border border-gray-200">
        <div class="text-lg font-semibold text-gray-800 mb-3">${title}</div>
        <div class="space-y-2">
          ${legendItems}
        </div>
        <div class="mt-3 pt-2 border-t border-gray-200">
          <div class="flex justify-between items-center">
            <span class="text-sm font-medium">Total</span>
            <span class="text-sm font-medium">${filteredJobs.length}</span>
          </div>
        </div>
      </div>
    `;
  }, []);

  // Update charts when data changes
  useEffect(() => {
    if (!d3Loaded || loading) return;

    // Apply time filter to all jobs
    const filteredJobs = filterJobsByTime ? filterJobsByTime(jobs) : jobs;
    
    console.log('📊 Analytics Tab - Rendering charts with', filteredJobs.length, 'filtered jobs (', jobs.length, 'total )');

    renderModernGauge(filteredJobs);
    renderStackedBarChart(filteredJobs);
    renderHeatmap(filteredJobs);
    renderJobTypeSummary(filteredJobs);
    
    // Render donut charts
    renderDonutChart(filteredJobs, jobTypeDonutRef, "Job Types", null);
    renderDonutChart(filteredJobs, testJobDonutRef, "Test Jobs", job => parseJobType(job) === "Test Job");
    renderDonutChart(filteredJobs, airflowJobDonutRef, "Airflow Jobs", job => parseJobType(job) === "Airflow Job");
    
    // Render legends
    renderLegend(filteredJobs, jobTypeLegendRef, "All Jobs", null);
    renderLegend(filteredJobs, testJobLegendRef, "Test Jobs", job => parseJobType(job) === "Test Job");
    renderLegend(filteredJobs, airflowJobLegendRef, "Airflow Jobs", job => parseJobType(job) === "Airflow Job");
    
  }, [d3Loaded, jobs, loading, filterJobsByTime, renderModernGauge, renderStackedBarChart, renderHeatmap, renderDonutChart, renderLegend, renderJobTypeSummary, parseJobType]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Top Row - Gauge Chart (20%) and Job Status Breakdown (80%) - Increased chart width */}
      <div className="flex gap-6 h-80">
        {/* Modern Gauge Chart - 20% (reduced from 25%) */}
        <div className="w-1/5 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Total Jobs & Success Rate</h3>
          <div ref={gaugeRef} className="flex items-center justify-center h-full"></div>
        </div>
        
        {/* Job Type Breakdown - 80% (increased from 75%) */}
        <div className="w-4/5 bg-white rounded-lg shadow-sm border border-gray-200 p-4 overflow-hidden">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Test Jobs vs Airflow Jobs Over Time</h3>
          <div ref={chartRef} className="w-full" style={{height: 'calc(100% - 3rem)'}}></div>
        </div>
      </div>

      {/* Second Row - Activity Heatmap */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Job Activity Heatmap: 24-Hour Timeline by Day of Week</h3>
        <div ref={heatmapRef} className="w-full h-72 min-h-[288px]"></div>
      </div>

      {/* Third Row - Job Type Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* All Jobs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">All Jobs Distribution</h3>
          <div ref={jobTypeDonutRef} className="flex justify-center mb-4"></div>
          <div ref={jobTypeLegendRef}></div>
        </div>

        {/* Test Jobs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">Test Jobs Status</h3>
          <div ref={testJobDonutRef} className="flex justify-center mb-4"></div>
          <div ref={testJobLegendRef}></div>
        </div>

        {/* Airflow Jobs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">Airflow Jobs Status</h3>
          <div ref={airflowJobDonutRef} className="flex justify-center mb-4"></div>
          <div ref={airflowJobLegendRef}></div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsTab;