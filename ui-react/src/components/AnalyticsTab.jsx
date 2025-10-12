import { useEffect, useRef, useState } from 'react';
import { toTs } from '../utils/api';

// Ensure toTs is available globally for time filtering
if (typeof window !== 'undefined') {
  window.toTs = toTs;
}

// Simple deep equality check - MOVED OUTSIDE COMPONENT
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

// Parse job type helper - MOVED OUTSIDE COMPONENT to prevent circular dependencies
const parseJobType = (job) => {
  try {
    if (job && job.labels && job.labels["job-type"] === "test") return "Test Job";
    return "Airflow Job";
  } catch (error) {
    console.warn('Error parsing job type:', error);
    return "Airflow Job";
  }
};

const AnalyticsTab = ({ jobs, filterJobsByTime, autoRefresh, timezone }) => {
  const chartRef = useRef(null);
  const [prevBarData, setPrevBarData] = useState([]);
  const gaugeRef = useRef(null);
  const heatmapRef = useRef(null);
  const jobTypeDonutRef = useRef(null);
  const testJobDonutRef = useRef(null);
  const lineChartRef = useRef(null);
  const pieChartRef = useRef(null);
  
  // Enhanced debugging for timezone issues
  console.log('🎯 AnalyticsTab Props Debug:', {
    timezone,
    jobsCount: jobs?.length || 0,
    autoRefresh,
    sampleJob: jobs?.[0] ? {
      id: jobs[0].id,
      created_at: jobs[0].created_at,
      updated_at: jobs[0].updated_at,
      status: jobs[0].status
    } : null
  });

  // Helper function to convert UTC date to selected timezone using offset calculation
  const convertToTimezone = (utcDate, targetTimezone) => {
    console.log(`🔍 Converting timezone - Input: ${utcDate.toISOString()}, Target: ${targetTimezone}`);
    
    if (!targetTimezone || targetTimezone === 'UTC') {
      console.log(`⏰ No timezone conversion needed, using UTC`);
      return new Date(utcDate);
    }
    
    try {
      // For IST specifically, we know it's UTC+5:30
      let offsetMinutes = 0;
      
      if (targetTimezone === 'Asia/Kolkata' || targetTimezone === 'Asia/Calcutta' || targetTimezone.includes('IST')) {
        offsetMinutes = 5 * 60 + 30; // IST is UTC+5:30
        console.log(`🇮🇳 Using IST offset: +${offsetMinutes} minutes`);
      } else {
        // For other timezones, calculate offset using toLocaleString
        const utcTime = utcDate.getTime();
        const utcHour = utcDate.getUTCHours();
        
        // Get the hour in target timezone
        const targetHour = parseInt(utcDate.toLocaleString('en-US', { 
          timeZone: targetTimezone, 
          hour: '2-digit', 
          hour12: false 
        }));
        
        offsetMinutes = (targetHour - utcHour) * 60;
        if (offsetMinutes > 12 * 60) offsetMinutes -= 24 * 60; // Handle day wraparound
        if (offsetMinutes < -12 * 60) offsetMinutes += 24 * 60;
        
        console.log(`🌐 Calculated offset for ${targetTimezone}: ${offsetMinutes} minutes`);
      }
      
      // Apply the offset to the UTC time
      const offsetMs = offsetMinutes * 60 * 1000;
      const adjustedTime = utcDate.getTime() + offsetMs;
      const result = new Date(adjustedTime);
      
      console.log(`🌍 Timezone conversion:`);
      console.log(`  UTC: ${utcDate.toISOString()} (${utcDate.getUTCHours()}h/${utcDate.getUTCDay()}d)`);
      console.log(`  Offset: +${offsetMinutes} minutes`);
      console.log(`  Result: ${result.toISOString()} (${result.getHours()}h/${result.getDay()}d)`);
      
      return result;
    } catch (error) {
      console.error('❌ Timezone conversion failed:', error);
      return new Date(utcDate);
    }
  };

  // Test timezone conversion with current time
  if (timezone) {
    const testDate = new Date();
    const convertedTest = convertToTimezone(testDate, timezone);
    console.log('🧪 Timezone conversion test:', {
      input: testDate.toISOString(),
      timezone: timezone,
      output: convertedTest.toString(),
      hourDiff: convertedTest.getHours() - testDate.getUTCHours()
    });
  }

  const airflowJobDonutRef = useRef(null);
  const jobTypeLegendRef = useRef(null);
  const testJobLegendRef = useRef(null);
  const airflowJobLegendRef = useRef(null);

  const [d3Loaded, setD3Loaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prevData, setPrevData] = useState({ dualGauge: null });

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
    
    // Add timeout to prevent indefinite loading
    const timeoutId = setTimeout(() => {
      if (!window.d3) {
        console.error('D3.js loading timeout');
        setError('Visualization library loading timeout');
        setLoading(false);
      }
    }, 10000); // 10 second timeout
    
    document.head.appendChild(script);

    return () => {
      clearTimeout(timeoutId);
      const existingScript = document.querySelector('script[src="https://d3js.org/d3.v7.min.js"]');
      if (existingScript) {
        document.head.removeChild(existingScript);
      }
    };
  }, []);

  // Helper for Job Type Summary
  const renderJobTypeSummary = (jobs) => {
    const container = jobTypeLegendRef.current;
    if (!container || !jobs) return;

    try {
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
    } catch (error) {
      console.error('Error rendering job type summary:', error);
      container.innerHTML = `
        <div class="bg-red-50 rounded-lg p-4 text-center">
          <div class="text-red-500 text-sm">Error loading job summary</div>
        </div>
      `;
    }
  };

  // Modern Gauge Chart
  const renderModernGauge = (jobs) => {
    if (!gaugeRef.current || !jobs) return;
    
    try {
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
    } catch (error) {
      console.error('Error rendering modern gauge:', error);
      if (gaugeRef.current) {
        gaugeRef.current.innerHTML = `
          <div class="text-red-500 text-center p-4">
            Error loading gauge chart
          </div>
        `;
      }
    }
  };

  // Create time-based data with automatic intervals - moved outside to avoid hoisting issues
  const createTimeSeriesData = (jobs) => {
    const filteredJobs = jobs;
    console.log('🔍 Processing', filteredJobs.length, 'jobs for time-based chart data');
    console.log('🌍 Current timezone for stacked bar chart:', timezone);

    // Convert all timestamps to selected timezone for proper time range calculation - using heatmap approach
    const timezoneTimestamps = filteredJobs
      .map(job => {
        // Use same direct approach as heatmap
        const originalDate = new Date(job.updated_at || job.created_at);
        if (!isNaN(originalDate.getTime())) {
          const timezoneDate = convertToTimezone(originalDate, timezone);
          return timezoneDate.getTime();
        }
        return null;
      })
      .filter(t => t !== null);
      
    console.log('📅 Valid timezone-adjusted timestamps found:', timezoneTimestamps.length);
    if (!timezoneTimestamps.length) {
      console.log('❌ No valid timestamps found in jobs');
      return [];
    }
    
    const minTime = Math.min(...timezoneTimestamps);
    const maxTime = Math.max(...timezoneTimestamps);
    const timeSpan = maxTime - minTime;
    
    // Auto-select interval: 15min, 1hr, 6hr, or 1day based on span
    let intervalMs;
    if (timeSpan <= 6 * 60 * 60 * 1000) intervalMs = 15 * 60 * 1000; // 15 minutes
    else if (timeSpan <= 48 * 60 * 60 * 1000) intervalMs = 60 * 60 * 1000; // 1 hour
    else if (timeSpan <= 7 * 24 * 60 * 60 * 1000) intervalMs = 6 * 60 * 60 * 1000; // 6 hours
    else intervalMs = 24 * 60 * 60 * 1000; // 1 day

    // Create time buckets - key insight: we need to map timezone buckets to UTC timestamps for D3 axis
    const bins = {};
    const bucketToUTCMap = {}; // Map timezone bucket to corresponding UTC time
    const startTime = Math.floor(minTime / intervalMs) * intervalMs;
    const endTime = Math.ceil(maxTime / intervalMs) * intervalMs;
    
    // Initialize all time buckets
    for (let time = startTime; time <= endTime; time += intervalMs) {
      bins[time] = { 
        testJobs: 0, 
        airflowJobs: 0, 
        total: 0 
      };
    }

    // Populate buckets with timezone-adjusted job data and track corresponding UTC times
    filteredJobs.forEach((job, index) => {
      // Use the same direct approach as the heatmap for consistency
      const originalDate = new Date(job.updated_at || job.created_at);
      
      // Check if the date is valid
      if (isNaN(originalDate.getTime())) {
        console.warn(`❌ Invalid timestamp for job ${job.job_id || 'unknown'}:`, job.updated_at, job.created_at);
        return;
      }
      
      // Convert to timezone - same as heatmap
      const timezoneDate = convertToTimezone(originalDate, timezone);
      const adjustedJobTime = timezoneDate.getTime();
      
      // Find the appropriate bucket based on timezone-converted time
      const bucket = Math.floor(adjustedJobTime / intervalMs) * intervalMs;
      
      if (bins[bucket]) {
        // Store the original UTC time that corresponds to this timezone bucket
        if (!bucketToUTCMap[bucket]) {
          // Calculate the UTC time that would display as the timezone bucket time
          // This is the reverse conversion: if timezone bucket shows "13:00 IST", 
          // we want the UTC time that would be "13:00" when converted to IST
          const timezoneOffsetMs = convertToTimezone(new Date(0), timezone).getTime() - new Date(0).getTime();
          bucketToUTCMap[bucket] = new Date(bucket - timezoneOffsetMs);
        }
        
        const jobType = parseJobType(job);
        if (jobType === "Test Job") {
          bins[bucket].testJobs += 1;
        } else {
          bins[bucket].airflowJobs += 1;
        }
        bins[bucket].total += 1;
        
        console.log(`📋 Job ${index + 1}: ${job.job_id || 'unknown'} - ${originalDate.toISOString()} → ${timezoneDate.toString()} → bucket ${new Date(bucket).toString()}`);
      } else {
        console.warn(`❌ No bucket found for job ${job.job_id || 'unknown'}: bucket=${bucket}, original=${originalDate.toISOString()}, timezone=${timezoneDate.toString()}`);
      }
    });

    // Create result with proper UTC timestamps for D3 axis
    const result = Object.keys(bins)
      .map(bucket => ({
        timestamp: bucketToUTCMap[bucket] || new Date(parseInt(bucket)),
        testJobs: bins[bucket].testJobs,
        airflowJobs: bins[bucket].airflowJobs,
        total: bins[bucket].total
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    console.log('📊 Time-based chart data created:', result.length, 'time bins');
    return result;
  };

  // Line Chart for Success Rate Trend
  const renderLineChart = (jobs) => {
    if (!lineChartRef.current || !window.d3) return;
    
    const container = lineChartRef.current;
    container.innerHTML = "";
    
    // EXPLICIT EMPTY STATE HANDLING
    if (jobs.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 200px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📈</div>
            <div>No trend data available</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Success rate trends will appear when jobs are available</div>
          </div>
        </div>
      `;
      return;
    }
    
    console.log('📈 Rendering line chart with', jobs.length, 'jobs');
    
    // Create time-based data for success rate trend
    const data = createTimeSeriesData(jobs);
    if (data.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 200px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📈</div>
            <div>Unable to process trend data</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Check if jobs have valid timestamps</div>
          </div>
        </div>
      `;
      return;
    }
    
    // Calculate success rates for each time point
    // Need to calculate based on actual job statuses from the filtered jobs
    const trendData = data.map(d => {
      // Get jobs for this time period
      const periodJobs = jobs.filter(job => {
        const originalDate = new Date(job.updated_at || job.created_at);
        if (isNaN(originalDate.getTime())) return false;
        const timezoneDate = convertToTimezone(originalDate, timezone);
        const jobTime = timezoneDate.getTime();
        const intervalMs = data.length > 1 ? (data[1].timestamp - data[0].timestamp) : 60 * 60 * 1000;
        const bucketStart = d.timestamp.getTime();
        const bucketEnd = bucketStart + intervalMs;
        return jobTime >= bucketStart && jobTime < bucketEnd;
      });
      
      const succeededJobs = periodJobs.filter(j => j.status === "SUCCEEDED").length;
      const totalJobs = periodJobs.length;
      
      return {
        timestamp: d.timestamp,
        total: totalJobs,
        successRate: totalJobs > 0 ? (succeededJobs / totalJobs * 100) : 0,
        jobCount: totalJobs,
        succeededCount: succeededJobs
      };
    });
    
    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const containerWidth = Math.max(500, (containerRect.width || 800) - 40);
    const containerHeight = Math.max(250, (containerRect.height || 300) - 20);
    
    const margin = { top: 20, right: 80, bottom: 80, left: 80 }; // Increased left margin
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;
    
    // Create SVG
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("background", "transparent")
      .style("display", "block");
      
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Scales
    const xScale = window.d3.scaleTime()
      .domain(window.d3.extent(trendData, d => d.timestamp))
      .range([0, width]);
    
    const yScaleRate = window.d3.scaleLinear()
      .domain([0, 100])
      .range([height, 0]);
    
    const yScaleCount = window.d3.scaleLinear()
      .domain([0, window.d3.max(trendData, d => d.jobCount) || 10])
      .range([height, 0]);
    
    // Line generators
    const successRateLine = window.d3.line()
      .x(d => xScale(d.timestamp))
      .y(d => yScaleRate(d.successRate))
      .curve(window.d3.curveMonotoneX);
    
    const jobCountLine = window.d3.line()
      .x(d => xScale(d.timestamp))
      .y(d => yScaleCount(d.jobCount))
      .curve(window.d3.curveMonotoneX);
    
    // Add grid lines
    const yGrid = window.d3.axisLeft(yScaleRate)
      .tickSize(-width)
      .tickFormat("");
    
    g.append("g")
      .attr("class", "grid")
      .style("opacity", 0.3)
      .style("stroke", "#e5e7eb")
      .call(yGrid);
    
    // Success rate line (primary)
    g.append("path")
      .datum(trendData)
      .attr("class", "success-rate-line")
      .attr("fill", "none")
      .attr("stroke", "#10b981")
      .attr("stroke-width", 3)
      .attr("d", successRateLine);
    
    // Job count line (secondary)
    g.append("path")
      .datum(trendData)
      .attr("class", "job-count-line")
      .attr("fill", "none")
      .attr("stroke", "#6366f1")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5")
      .attr("d", jobCountLine);
    
    // Add dots for data points
    g.selectAll(".success-dot")
      .data(trendData)
      .enter().append("circle")
      .attr("class", "success-dot")
      .attr("cx", d => xScale(d.timestamp))
      .attr("cy", d => yScaleRate(d.successRate))
      .attr("r", 4)
      .attr("fill", "#10b981")
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .style("cursor", "pointer");
    
    g.selectAll(".count-dot")
      .data(trendData)
      .enter().append("circle")
      .attr("class", "count-dot")
      .attr("cx", d => xScale(d.timestamp))
      .attr("cy", d => yScaleCount(d.jobCount))
      .attr("r", 3)
      .attr("fill", "#6366f1")
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .style("cursor", "pointer");
    
    // Create tooltip
    const tooltip = window.d3.select(container)
      .append("div")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background", "#fff")
      .style("color", "#334155")
      .style("padding", "12px 16px")
      .style("border-radius", "8px")
      .style("font-size", "14px")
      .style("box-shadow", "0 4px 12px rgba(0,0,0,0.15)")
      .style("border", "1px solid #e5e7eb")
      .style("pointer-events", "none")
      .style("z-index", "1000");

    // Add hover events
    const allDots = g.selectAll(".success-dot, .count-dot");
    allDots
      .on("mouseover", function(event, d) {
        const timezoneDate = convertToTimezone(d.timestamp, timezone);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const dateStr = `${timezoneDate.getDate()}-${monthNames[timezoneDate.getMonth()]}-${timezoneDate.getFullYear()}`;
        const timeStr = `${timezoneDate.getHours().toString().padStart(2, '0')}:${timezoneDate.getMinutes().toString().padStart(2, '0')}`;
        
        window.d3.select(this).attr("r", 6);
        
        tooltip.transition().duration(200).style("opacity", 1);
        tooltip.html(`
          <div style="font-weight: 600; margin-bottom: 4px;">${dateStr} ${timeStr}</div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="width: 12px; height: 12px; background: #10b981; border-radius: 50%; display: inline-block;"></span>
            <span>Success Rate: <strong>${d.successRate.toFixed(1)}%</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 12px; height: 12px; background: #6366f1; border-radius: 50%; display: inline-block;"></span>
            <span>Job Count: <strong>${d.jobCount}</strong></span>
          </div>
        `)
          .style("left", (event.pageX + 12) + "px")
          .style("top", (event.pageY - 8) + "px");
      })
      .on("mouseout", function(event, d) {
        const isSuccessDot = window.d3.select(this).classed("success-dot");
        window.d3.select(this).attr("r", isSuccessDot ? 4 : 3);
        tooltip.transition().duration(300).style("opacity", 0);
      });
    
    // X axis (time-based)
    const timeRange = window.d3.extent(trendData, d => d.timestamp);
    const timeSpan = timeRange[1] - timeRange[0];
    
    const createTimezoneFormatter = (formatString) => {
      return (date) => {
        const localDate = convertToTimezone(date, timezone);
        return window.d3.timeFormat(formatString)(localDate);
      };
    };
    
    let timeFormat;
    let tickInterval;
    if (timeSpan <= 6 * 60 * 60 * 1000) {
      timeFormat = createTimezoneFormatter("%H:%M");
      tickInterval = window.d3.timeMinute.every(30);
    } else if (timeSpan <= 2 * 24 * 60 * 60 * 1000) {
      timeFormat = createTimezoneFormatter("%d %b %H:%M");
      tickInterval = window.d3.timeHour.every(4);
    } else if (timeSpan <= 7 * 24 * 60 * 60 * 1000) {
      timeFormat = createTimezoneFormatter("%d-%b");
      tickInterval = window.d3.timeDay.every(1);
    } else {
      timeFormat = createTimezoneFormatter("%d-%b-%Y");
      tickInterval = window.d3.timeDay.every(Math.ceil(timeSpan / (7 * 24 * 60 * 60 * 1000)));
    }
    
    const xAxis = window.d3.axisBottom(xScale)
      .ticks(tickInterval)
      .tickFormat(timeFormat);
    
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .selectAll("text")
      .style("text-anchor", "end")
      .style("font-size", "11px")
      .attr("dx", "-.8em")
      .attr("dy", ".15em")
      .attr("transform", "rotate(-45)");
    
    // Left Y axis (Success Rate)
    g.append("g")
      .call(window.d3.axisLeft(yScaleRate)
        .tickFormat(d => d + "%"))
      .selectAll("text")
      .style("font-size", "12px")
      .style("fill", "#10b981");
    
    // Right Y axis (Job Count)
    g.append("g")
      .attr("transform", `translate(${width}, 0)`)
      .call(window.d3.axisRight(yScaleCount)
        .tickFormat(window.d3.format("d")))
      .selectAll("text")
      .style("font-size", "12px")
      .style("fill", "#6366f1");
    
    // Y axis labels
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left + 15) // Move label further from edge
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "500")
      .style("fill", "#10b981")
      .text("Success Rate (%)");
    
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", width + margin.right - 35) // Move label much closer to axis
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "500")
      .style("fill", "#6366f1")
      .text("Job Count");
  };

  // Pie Chart for Job Status Distribution
  const renderPieChart = (jobs) => {
    if (!pieChartRef.current || !window.d3) return;
    
    const container = pieChartRef.current;
    container.innerHTML = "";
    
    // EXPLICIT EMPTY STATE HANDLING
    if (jobs.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 250px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">🥧</div>
            <div>No status data available</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Job status breakdown will appear when jobs are available</div>
          </div>
        </div>
      `;
      return;
    }
    
    console.log('🥧 Rendering pie chart with', jobs.length, 'jobs');
    
    // Count by status
    const statusCounts = jobs.reduce((acc, job) => {
      const status = job.status || 'UNKNOWN';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    // Convert to array format for D3
    const data = Object.entries(statusCounts).map(([status, count]) => ({
      label: status,
      value: count,
      percentage: ((count / jobs.length) * 100).toFixed(1)
    })).sort((a, b) => b.value - a.value); // Sort by count descending
    
    if (data.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 250px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">🥧</div>
            <div>Unable to process status data</div>
          </div>
        </div>
      `;
      return;
    }
    
    // Get container dimensions - optimized for column layout
    const containerRect = container.getBoundingClientRect();
    const containerWidth = Math.max(280, (containerRect.width || 350) - 20);
    const containerHeight = Math.max(280, (containerRect.height || 320) - 20);
    
    const radius = Math.min(containerWidth, containerHeight) / 2 - 60; // More padding for labels
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2 - 20; // Shift up to make room for legend
    
    // Create SVG
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("background", "transparent")
      .style("display", "block");
      
    const g = svg.append("g")
      .attr("transform", `translate(${centerX},${centerY})`);
    
    // Color scale - status-based colors
    const colorMap = {
      'SUCCEEDED': '#22c55e',  // Green
      'FAILED': '#ef4444',     // Red  
      'RUNNING': '#f59e0b',    // Orange
      'PENDING': '#6b7280',    // Gray
      'QUEUED': '#8b5cf6',     // Purple
      'CANCELLED': '#64748b',  // Slate
      'UNKNOWN': '#9ca3af'     // Light gray
    };
    
    const color = d => colorMap[d.label] || '#9ca3af';
    
    // Pie generator
    const pie = window.d3.pie()
      .value(d => d.value)
      .sort(null); // Keep original order
      
    // Arc generator
    const arc = window.d3.arc()
      .innerRadius(0)
      .outerRadius(radius);
      
    // Arc generator for labels (slightly outside)
    const labelArc = window.d3.arc()
      .innerRadius(radius + 10)
      .outerRadius(radius + 10);
    
    // Create tooltip
    const tooltip = window.d3.select(container)
      .append("div")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background", "#fff")
      .style("color", "#334155")
      .style("padding", "12px 16px")
      .style("border-radius", "8px")
      .style("font-size", "14px")
      .style("box-shadow", "0 4px 12px rgba(0,0,0,0.15)")
      .style("border", "1px solid #e5e7eb")
      .style("pointer-events", "none")
      .style("z-index", "1000");
    
    // Draw pie slices
    const arcs = g.selectAll(".arc")
      .data(pie(data))
      .enter().append("g")
      .attr("class", "arc");
      
    // Add pie slices with hover effects
    arcs.append("path")
      .attr("d", arc)
      .attr("fill", d => color(d.data))
      .style("stroke", "#fff")
      .style("stroke-width", "2px")
      .style("cursor", "pointer")
      .style("opacity", 0.9)
      .on("mouseover", function(event, d) {
        // Expand slice slightly
        window.d3.select(this)
          .transition()
          .duration(200)
          .attr("transform", () => {
            const centroid = arc.centroid(d);
            const factor = 0.05; // How much to expand
            return `translate(${centroid[0] * factor},${centroid[1] * factor})`;
          })
          .style("opacity", 1);
          
        // Show tooltip
        tooltip.transition().duration(200).style("opacity", 1);
        tooltip.html(`
          <div style="font-weight: 600; margin-bottom: 4px; color: ${color(d.data)};">${d.data.label}</div>
          <div>Jobs: <strong>${d.data.value}</strong></div>
          <div>Percentage: <strong>${d.data.percentage}%</strong></div>
        `)
          .style("left", (event.pageX + 12) + "px")
          .style("top", (event.pageY - 8) + "px");
      })
      .on("mouseout", function(event, d) {
        // Reset slice position
        window.d3.select(this)
          .transition()
          .duration(200)
          .attr("transform", "translate(0,0)")
          .style("opacity", 0.9);
          
        // Hide tooltip
        tooltip.transition().duration(300).style("opacity", 0);
      });
    
    // Add value labels on slices (for larger slices)
    arcs.append("text")
      .attr("transform", d => {
        const centroid = arc.centroid(d);
        return `translate(${centroid[0]},${centroid[1]})`;
      })
      .attr("dy", "0.35em")
      .style("text-anchor", "middle")
      .style("font-size", "12px")
      .style("font-weight", "600")
      .style("fill", "white")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.5)")
      .text(d => {
        // Only show count if the slice is large enough (> 5% of total)
        const percentage = (d.endAngle - d.startAngle) / (2 * Math.PI) * 100;
        return percentage > 5 ? d.data.value : "";
      });
    
    // Add external labels for status names
    arcs.append("text")
      .attr("transform", d => `translate(${labelArc.centroid(d)})`)
      .attr("dy", "0.35em")
      .style("text-anchor", d => {
        // Determine text anchor based on angle
        const angle = (d.startAngle + d.endAngle) / 2;
        return angle > Math.PI ? "end" : "start";
      })
      .style("font-size", "11px")
      .style("font-weight", "500")
      .style("fill", "#374151")
      .text(d => {
        // Only show label if slice is significant enough
        const percentage = (d.endAngle - d.startAngle) / (2 * Math.PI) * 100;
        return percentage > 3 ? `${d.data.label} (${d.data.percentage}%)` : "";
      });
    
    // Add center title
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.5em")
      .style("font-size", "18px")
      .style("font-weight", "700")
      .style("fill", "#1f2937")
      .text("Job Status");
      
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1em")
      .style("font-size", "14px")
      .style("font-weight", "500")
      .style("fill", "#6b7280")
      .text(`Total: ${jobs.length}`);
    
    // Add legend below the pie chart - optimized for column layout
    const legendY = centerY + radius + 25;
    const legend = svg.append("g")
      .attr("class", "pie-legend")
      .attr("transform", `translate(${centerX},${legendY})`);
    
    // Calculate legend layout - single column for narrow space
    const itemsPerRow = 1; // Single column layout
    const legendItemWidth = 100;
    const legendStartX = -legendItemWidth / 2;
    
    const legendItems = legend.selectAll(".legend-item")
      .data(data)
      .enter().append("g")
      .attr("class", "legend-item")
      .attr("transform", (d, i) => {
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        const x = legendStartX + col * legendItemWidth;
        const y = row * 25;
        return `translate(${x}, ${y})`;
      });
    
    legendItems.append("circle")
      .attr("r", 6)
      .attr("fill", d => color(d))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1);
    
    legendItems.append("text")
      .attr("x", 12)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .style("font-size", "10px")
      .style("font-weight", "500")
      .style("fill", "#374151")
      .text(d => `${d.label}: ${d.value}`);
  };

  const renderStackedBarChart = (jobs) => {
    if (!chartRef.current) {
      console.log('❌ Chart container ref not available');
      return;
    }
    if (!window.d3) {
      console.log('❌ D3.js not loaded yet');
      return;
    }
    console.log('📊 Rendering stacked bar chart with', jobs.length, 'jobs');
    console.log('🌍 Stacked bar chart timezone:', timezone);
    console.log('📅 Chart will use timezone conversion:', timezone !== 'UTC' && timezone);
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
    const data = createTimeSeriesData(jobs);
    if (data.length === 0) {
      console.log('❌ No time-based chart data created - showing empty state');
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-center; height: 100%; min-height: 200px; color: #9ca3af; font-size: 1.1rem; font-weight: 500;">
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
            <div>Unable to process job data for time-based chart</div>
            <div style="font-size: 0.9rem; color: #6b7280; margin-top: 0.5rem;">Check if jobs have valid timestamps</div>
          </div>
        </div>
      `;
      return;
    }
    // Compare previous bar data
    let shouldAnimate = true;
    if (prevBarData.length === data.length) {
      shouldAnimate = !data.every((d, i) => {
        const prev = prevBarData[i];
        return prev && prev.testJobs === d.testJobs && prev.airflowJobs === d.airflowJobs && prev.total === d.total;
      });
    }
    setPrevBarData(data);
    
    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const containerWidth = Math.max(500, (containerRect.width || 800) - 40);
    const containerHeight = Math.max(250, (containerRect.height || 300) - 20);
    
    console.log('📐 Chart dimensions:', { containerWidth, containerHeight });
    
    const margin = { top: 20, right: 160, bottom: 80, left: 60 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;
    
    // Create SVG
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("background", "transparent")
      .style("display", "block");
      
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Color scale - green-based theme
    const color = window.d3.scaleOrdinal()
      .domain(["Test Jobs", "Airflow Jobs"])
      .range(["#A4DCBC", "#21C55E"]); // Emerald green for Test Jobs, Success green for Airflow Jobs

    // Calculate bar width and gap to prevent overlap
    const minGap = 12; // Increased minimum gap between bars in px
    const barSlot = width / data.length;
    const barWidth = Math.max(8, Math.min(28, barSlot - minGap)); // Reduce max width, enforce larger gap, but keep a minimum width

    // Time-based X scale with padding to prevent overlap with Y-axis
    const xPadding = Math.max(barWidth / 2, 20); // Ensure at least 20px or half bar width padding
    const xScale = window.d3.scaleTime()
      .domain(window.d3.extent(data, d => d.timestamp))
      .range([xPadding, width - xPadding]);
    
    const yScale = window.d3.scaleLinear()
      .domain([0, window.d3.max(data, d => d.total) || 10])
      .range([height, 0]);
    
    // Stack generator
    const stack = window.d3.stack()
      .keys(["testJobs", "airflowJobs"]);
    
    const stackedData = stack(data);
    
    // Create tooltip
    const tooltip = window.d3.select(container)
      .append("div")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background", "#fff")
      .style("color", "#334155")
      .style("padding", "12px 16px")
      .style("border-radius", "8px")
      .style("font-size", "14px")
      .style("box-shadow", "0 4px 12px rgba(0,0,0,0.15)")
      .style("border", "1px solid #e5e7eb")
      .style("pointer-events", "none")
      .style("z-index", "1000");

    // Add grid lines
    const yGrid = window.d3.axisLeft(yScale)
      .tickSize(-width)
      .tickFormat("");
    
    g.append("g")
      .attr("class", "grid")
      .style("opacity", 0.3)
      .style("stroke", "#e5e7eb")
      .call(yGrid);
    
    // Draw stacked bars
    g.selectAll(".serie")
      .data(stackedData)
      .enter().append("g")
      .attr("class", "serie")
      .attr("fill", (d, i) => color(i === 0 ? "Test Jobs" : "Airflow Jobs"))
      .selectAll("rect")
      .data(d => d)
      .enter().append("rect")
      .attr("x", d => xScale(d.data.timestamp) - barWidth / 2)
      .attr("width", barWidth)
      .style("cursor", "pointer")
      .style("opacity", 0.9)
      .attr("y", shouldAnimate ? yScale(0) : d => yScale(d[1]))
      .attr("height", shouldAnimate ? 0 : d => yScale(d[0]) - yScale(d[1]))
      .call(sel => {
        if (shouldAnimate) {
          sel.transition()
            .duration(900)
            .attr("y", d => yScale(d[1]))
            .attr("height", d => yScale(d[0]) - yScale(d[1]));
        }
      })
      .on("mouseover", function(event, d) {
        const serie = window.d3.select(this.parentNode).datum();
        const date = d.data.timestamp;
        // Format date in the selected timezone for tooltip
        const timezoneDate = convertToTimezone(date, timezone);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const dateStr = `${timezoneDate.getDate()}-${monthNames[timezoneDate.getMonth()]}-${timezoneDate.getFullYear()}`;
        const timeStr = `${timezoneDate.getHours().toString().padStart(2, '0')}:${timezoneDate.getMinutes().toString().padStart(2, '0')}`;
        const total = d.data.total;
        const airflowJobs = d.data.airflowJobs;
        const testJobs = d.data.testJobs;

        window.d3.select(this).style("opacity", 0.7);

        tooltip.transition().duration(200).style("opacity", 1);
        tooltip.html(`
          <div style="font-weight: 600; margin-bottom: 4px;">${dateStr} ${timeStr}</div>
          <div>Total Jobs: <strong>${total}</strong></div>
          <div style="margin-top: 8px; margin-bottom: 2px; font-size: 13px; font-weight: 500; color: #64748b;">Job Type Breakdown:</div>
          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 4px;">
            <span style="display: flex; align-items: center; gap: 4px;">
              <span style="width: 12px; height: 12px; background: #21C55E; border-radius: 2px; display: inline-block;"></span>
              <span style="color: #334155;">Airflow Jobs:</span>
              <strong style="margin-left: 2px; color: #21C55E;">${airflowJobs}</strong>
            </span>
            <span style="display: flex; align-items: center; gap: 4px;">
              <span style="width: 12px; height: 12px; background: #A4DCBC; border-radius: 2px; display: inline-block;"></span>
              <span style="color: #334155;">Test Jobs:</span>
              <strong style="margin-left: 2px; color: #A4DCBC;">${testJobs}</strong>
            </span>
          </div>
        `)
          .style("left", (event.pageX + 12) + "px")
          .style("top", (event.pageY - 8) + "px");
      })
      .on("mouseout", function() {
        window.d3.select(this).style("opacity", 0.9);
        tooltip.transition().duration(300).style("opacity", 0);
      });
    
    // Add value labels on bars (only if bars are tall enough)
    g.selectAll(".serie")
      .selectAll(".label")
      .data(d => d)
      .enter().append("text")
      .attr("class", "label")
      .attr("x", d => xScale(d.data.timestamp))
      .attr("y", d => {
        const segmentHeight = yScale(d[0]) - yScale(d[1]);
        return yScale(d[1]) + segmentHeight / 2;
      })
      .attr("dy", "0.35em")
      .style("text-anchor", "middle")
      .style("font-size", "12px")
      .style("font-weight", "600")
      .style("fill", "white")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.3)")
      .text(d => {
        const count = d[1] - d[0];
        const segmentHeight = yScale(d[0]) - yScale(d[1]);
        // Only show count if segment is tall enough and count > 0
        return segmentHeight > 25 && count > 0 ? count : "";
      });
    
    // Time-based X axis with smart formatting (timezone-aware)
    const timeRange = window.d3.extent(data, d => d.timestamp);
    const timeSpan = timeRange[1] - timeRange[0];
    
    // Create timezone-aware formatter
    const createTimezoneFormatter = (formatString) => {
      return (date) => {
        // Convert to the selected timezone for display
        const localDate = convertToTimezone(date, timezone);
        return window.d3.timeFormat(formatString)(localDate);
      };
    };
    
    let timeFormat;
    let tickInterval;
    if (timeSpan <= 6 * 60 * 60 * 1000) { // Less than 6 hours
      timeFormat = createTimezoneFormatter("%H:%M");
      tickInterval = window.d3.timeMinute.every(30);
    } else if (timeSpan <= 2 * 24 * 60 * 60 * 1000) { // Less than 2 days
      timeFormat = createTimezoneFormatter("%d %b %H:%M");
      tickInterval = window.d3.timeHour.every(4);
    } else if (timeSpan <= 7 * 24 * 60 * 60 * 1000) { // Less than 7 days
      timeFormat = createTimezoneFormatter("%d-%b");
      tickInterval = window.d3.timeDay.every(1);
    } else {
      timeFormat = createTimezoneFormatter("%d-%b-%Y");
      tickInterval = window.d3.timeDay.every(Math.ceil(timeSpan / (7 * 24 * 60 * 60 * 1000)));
    }
    
    const xAxis = window.d3.axisBottom(xScale)
      .ticks(tickInterval)
      .tickFormat(timeFormat);
    
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .selectAll("text")
      .style("text-anchor", "end")
      .style("font-size", "11px")
      .attr("dx", "-.8em")
      .attr("dy", ".15em")
      .attr("transform", "rotate(-45)");
    
    g.append("g")
      .call(window.d3.axisLeft(yScale)
        .ticks(Math.min(10, window.d3.max(data, d => d.total) || 10))
        .tickFormat(window.d3.format("d"))) // Format as integers (no decimals)
      .selectAll("text")
      .style("font-size", "12px");
    
    // Add Y axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "500")
      .style("fill", "#374151")
      .text("Number of Jobs");
    
    // Add legend below the chart
    const legend = g.append("g")
      .attr("class", "legend")
      .attr("transform", `translate(0, ${height + 50})`);
    
    const totalTestJobs = data.reduce((sum, d) => sum + d.testJobs, 0);
    const totalAirflowJobs = data.reduce((sum, d) => sum + d.airflowJobs, 0);
    
    const legendData = [
      { label: "Test Jobs", color: "#A4DCBC", count: totalTestJobs },
      { label: "Airflow Jobs", color: "#21C55E", count: totalAirflowJobs }
    ];
    
    const legendItems = legend.selectAll(".legend-item")
      .data(legendData.filter(d => d.count > 0))
      .enter().append("g")
      .attr("class", "legend-item")
      .attr("transform", (d, i) => `translate(0, ${i * 25})`);
    
    legendItems.append("rect")
      .attr("width", 16)
      .attr("height", 16)
      .attr("fill", d => d.color)
      .attr("rx", 2);
    
    legendItems.append("text")
      .attr("x", 24)
      .attr("y", 8)
      .attr("dy", "0.35em")
      .style("font-size", "16px")
      .style("font-weight", "500")
      .style("fill", "#374151")
      .text(d => `${d.label}: ${d.count}`);
    
    // Position the legend within the right margin area
    legend.attr("transform", `translate(${width + 20}, 20)`);
  };

  const renderHeatmap = (jobs) => {
    console.log(`🗺️ Rendering heatmap with ${jobs.length} jobs, timezone: ${timezone}`);
    
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
    
    // GitHub-style heatmap: 7 rows (days), 24 columns (hours), square cells, green shades, small gaps
    const processData = (jobs) => {
      const data = [];
      const counts = {};
      jobs.forEach(job => {
        const originalDate = new Date(job.created_at || job.updated_at);
        const timezoneDate = convertToTimezone(originalDate, timezone);
        const day = timezoneDate.getDay();
        const hour = timezoneDate.getHours();
        const key = `${day}-${hour}`;
        counts[key] = (counts[key] || 0) + 1;
      });
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          data.push({
            day,
            hour,
            value: counts[`${day}-${hour}`] || 0
          });
        }
      }
      return data;
    };
    const data = processData(jobs);
    const maxValue = window.d3.max(data, d => d.value);
    // GitHub green color scale (5 shades)
    const githubGreenScale = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
    const color = d => {
      if (d.value === 0) return githubGreenScale[0];
      if (maxValue === 0) return githubGreenScale[0];
      const step = maxValue / 4;
      if (d.value >= step * 4) return githubGreenScale[4];
      if (d.value >= step * 3) return githubGreenScale[3];
      if (d.value >= step * 2) return githubGreenScale[2];
      if (d.value >= step * 1) return githubGreenScale[1];
      return githubGreenScale[0];
    };
    // Layout
    const margin = { top: 30, right: 10, bottom: 20, left: 40 };
    const cellSize = 18;
    const gap = 3;
    const width = 24 * (cellSize + gap);
    const height = 7 * (cellSize + gap);
    const containerRect = container.getBoundingClientRect();
    const svg = window.d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom + 40}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    // Add GitHub-style legend below the heatmap
    const legendY = height + margin.top + 10;
    const legendX = margin.left;
    const legend = svg.append("g")
      .attr("class", "github-legend")
      .attr("transform", `translate(${legendX},${legendY})`);
    // Legend label
    legend.append("text")
      .attr("x", 0)
      .attr("y", 14)
      .style("font-size", "13px")
      .style("fill", "#4b5563")
      .text("Less");
    // Color boxes
    githubGreenScale.forEach((c, i) => {
      legend.append("rect")
        .attr("x", 36 + i * (cellSize + 2))
        .attr("y", 4)
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("fill", c)
        .attr("stroke", "#d1d5db")
        .attr("rx", 2);
    });
    // Legend label
    legend.append("text")
      .attr("x", 36 + githubGreenScale.length * (cellSize + 2) + 8)
      .attr("y", 14)
      .style("font-size", "13px")
      .style("fill", "#4b5563")
      .text("More");
    // Draw cells
    g.selectAll(".cell")
      .data(data)
      .enter().append("rect")
      .attr("class", "cell")
      .attr("x", d => d.hour * (cellSize + gap))
      .attr("y", d => d.day * (cellSize + gap))
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("fill", color)
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        const tooltip = window.d3.select("body").append("div")
          .attr("class", "heatmap-tooltip")
          .style("position", "absolute")
          .style("background", "#fff")
          .style("color", "#216e39")
          .style("padding", "8px 12px")
          .style("border-radius", "6px")
          .style("font-size", "13px")
          .style("box-shadow", "0 2px 8px rgba(0,0,0,0.08)")
          .style("pointer-events", "none")
          .style("z-index", "1000");
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        tooltip.html(`<strong>${d.value} jobs</strong><br/>${days[d.day]}, ${d.hour}:00`)
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseout", function() {
        window.d3.selectAll(".heatmap-tooltip").remove();
      });
    // Minimal day labels (left)
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    g.selectAll(".day-label")
      .data(days)
      .enter().append("text")
      .attr("class", "day-label")
      .attr("x", -8)
      .attr("y", (d, i) => i * (cellSize + gap) + cellSize / 1.5)
      .style("text-anchor", "end")
      .style("font-size", "13px")
      .style("font-weight", "500")
      .style("fill", "#4b5563")
      .text(d => d);
    // Minimal hour labels (top)
    const hourLabels = [0, 6, 12, 18];
    g.selectAll(".hour-label")
      .data(hourLabels)
      .enter().append("text")
      .attr("class", "hour-label")
      .attr("x", d => d * (cellSize + gap) + cellSize / 2)
      .attr("y", -8)
      .style("text-anchor", "middle")
      .style("font-size", "13px")
      .style("font-weight", "500")
      .style("fill", "#4b5563")
      .text(d => `${d}:00`);
      
  };

  const renderDonutChart = (jobs, containerRef, title, filterFn) => {
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
      
  };

  const renderLegend = (jobs, containerRef, title, filterFn) => {
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
  };

  // Update charts when data changes - SIMPLIFIED to prevent circular dependencies
  useEffect(() => {
    if (!d3Loaded || loading) return;

    try {
      // Apply time filter to all jobs
      const filteredJobs = filterJobsByTime ? filterJobsByTime(jobs) : jobs;
      
      if (!filteredJobs || !Array.isArray(filteredJobs)) {
        console.warn('📊 Analytics Tab - Invalid jobs data:', filteredJobs);
        return;
      }
      
      console.log('📊 Analytics Tab - Rendering charts with', filteredJobs.length, 'filtered jobs (', jobs.length, 'total )');

      // Create simple render functions inline to avoid hoisting issues
      const renderCharts = () => {
        // Check all refs are available before rendering
        if (!gaugeRef.current || !chartRef.current || !heatmapRef.current || !lineChartRef.current || !pieChartRef.current) {
          console.warn('📊 Some chart containers not yet available, skipping render');
          return;
        }
        
        renderModernGauge(filteredJobs);
        renderStackedBarChart(filteredJobs);
        renderLineChart(filteredJobs);
        renderPieChart(filteredJobs);
        renderHeatmap(filteredJobs);
        renderJobTypeSummary(filteredJobs);
        
        // Define simple filter functions inline
        const testJobFilter = (job) => parseJobType(job) === "Test Job";
        const airflowJobFilter = (job) => parseJobType(job) === "Airflow Job";
        
        // Render donut charts with null checks
        if (jobTypeDonutRef.current) renderDonutChart(filteredJobs, jobTypeDonutRef.current, "Job Types", null);
        if (testJobDonutRef.current) renderDonutChart(filteredJobs, testJobDonutRef.current, "Test Jobs", testJobFilter);
        if (airflowJobDonutRef.current) renderDonutChart(filteredJobs, airflowJobDonutRef.current, "Airflow Jobs", airflowJobFilter);
        
        // Render legends with null checks
        if (jobTypeLegendRef.current) renderLegend(filteredJobs, jobTypeLegendRef.current, "All Jobs", null);
        if (testJobLegendRef.current) renderLegend(filteredJobs, testJobLegendRef.current, "Test Jobs", testJobFilter);
        if (airflowJobLegendRef.current) renderLegend(filteredJobs, airflowJobLegendRef.current, "Airflow Jobs", airflowJobFilter);
      };
      
      renderCharts();
    } catch (error) {
      console.error('📊 Analytics Tab - Error rendering charts:', error);
      setError(`Chart rendering failed: ${error.message}`);
    }
    
  }, [d3Loaded, jobs, loading, filterJobsByTime, timezone]);

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
      {/* Top Row - Gauge Chart (20%) and Job Status Breakdown (80%) */}
      <div className="flex gap-6 h-80">
        {/* Modern Gauge Chart - 20% */}
        <div className="w-1/5 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Total Jobs & Success Rate</h3>
          <div ref={gaugeRef} className="flex items-center justify-center h-full"></div>
        </div>
        {/* Job Type Breakdown - 80% */}
        <div className="w-4/5 bg-white rounded-lg shadow-sm border border-gray-200 p-4 overflow-hidden">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Test Jobs vs Airflow Jobs Distribution</h3>
          <div ref={chartRef} className="w-full" style={{height: 'calc(100% - 3rem)'}}></div>
        </div>
      </div>

      {/* Second Row - Pie Chart + Wide Success Trends Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Job Status Pie Chart - First Column */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">Job Status Distribution</h3>
          <div ref={pieChartRef} className="w-full h-80 min-h-[320px]"></div>
        </div>
        
        {/* Success Rate Trend Line Chart - Spans Second and Third Columns */}
        <div className="md:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">Success Rate & Job Count Trends Over Time</h3>
          <div ref={lineChartRef} className="w-full h-80 min-h-[320px]"></div>
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Job Activity Heatmap: 24-Hour Timeline by Day of Week</h3>
        <div ref={heatmapRef} className="w-full h-72 min-h-[288px]"></div>
      </div>
    </div>
  );
};

export default AnalyticsTab;