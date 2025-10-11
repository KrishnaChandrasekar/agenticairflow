import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchJSON, API_BASE, getAuthHeaders, toTs } from '../utils/api';

const SubmitJobDialog = ({ 
  agents, 
  preselectedAgent = '', 
  onClose, 
  onJobsTabClick, 
  onJobSubmitted 
}) => {
  const [selectedAgent, setSelectedAgent] = useState(preselectedAgent || '');
  const selectedAgentRef = useRef(selectedAgent);
  useEffect(() => { selectedAgentRef.current = selectedAgent; }, [selectedAgent]);
  const [command, setCommand] = useState('echo HELLO && sleep 2 && echo DONE');
  const [labels, setLabels] = useState('{}');
  const [output, setOutput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState({ show: false, message: '', type: 'info' });
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [currentJobId, setCurrentJobId] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const agentDropdownRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const outputRef = useRef(null);
  const lastStatusRef = useRef(null);

  // Helper function to get current job status
  const getCurrentJobStatus = () => {
    return currentStatus;
  };

  // Update selected agent when preselected changes
  useEffect(() => {
    setSelectedAgent(preselectedAgent || '');
  }, [preselectedAgent]);

  // Close agent dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target)) {
        setAgentDropdownOpen(false);
      }
    };

    if (agentDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [agentDropdownOpen]);

  // Close dialog when pressing Escape key
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Job status polling effect
  useEffect(() => {
    if (!currentJobId || !isPolling) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const pollJobStatus = async () => {
      try {
        const statusObj = await fetchJSON(`${API_BASE}/status/${currentJobId}`);
        
        // Convert to string for comparison (focusing on meaningful fields only)
        // Normalize values to handle null vs undefined differences
        const meaningfulFields = {
          status: statusObj.status || null,
          rc: statusObj.rc === undefined ? null : statusObj.rc,
          note: statusObj.note || null,
          agent_id: statusObj.agent_id || null,
          job_id: statusObj.job_id || null
        };
        const currentStatusString = JSON.stringify(meaningfulFields, null, 2);
        
        // Only update if the status response is different from the last one
        if (lastStatusRef.current !== currentStatusString) {
          // Debug logging (remove in production)
          console.log('Status change detected:');
          console.log('Previous:', lastStatusRef.current);
          console.log('Current:', currentStatusString);
          
          lastStatusRef.current = currentStatusString;
          
          // Format the output as pretty JSON with timestamp
          const timestamp = new Date().toLocaleTimeString();
          const formattedOutput = `[${timestamp}] Status Update:\n${JSON.stringify(statusObj, null, 2)}`;
          
          // Append to existing output instead of replacing
          setOutput(prev => {
            const separator = prev && prev !== 'submitting...' ? '\n\n' : '';
            const newOutput = prev === 'submitting...' ? formattedOutput : `${prev}${separator}${formattedOutput}`;
            
            // Auto-scroll to bottom after state update
            setTimeout(() => {
              if (outputRef.current) {
                outputRef.current.scrollTop = outputRef.current.scrollHeight;
              }
            }, 100);
            
            return newOutput;
          });
        } else {
          // Debug logging for no changes
          console.log('No status change detected, skipping update');
        }
        
        // Update current status for state diagram
        setCurrentStatus(statusObj.status?.toUpperCase() || '');

        // Stop polling if job is completed
        if (statusObj.status && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(statusObj.status.toUpperCase())) {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Error polling job status:', error);
        // On error, append the error message (always show errors)
        const timestamp = new Date().toLocaleTimeString();
        setOutput(prev => `${prev}\n\n[${timestamp}] Error fetching status: ${error.message}`);
      }
    };

    // Initial poll
    pollJobStatus();
    
    // Set up polling interval
    pollingIntervalRef.current = setInterval(pollJobStatus, 2000); // Poll every 2 seconds

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [currentJobId, isPolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // Determine agent status for validation
  const getAgentStatus = useCallback((agentId) => {
    if (!agentId) return null;
    
    const agent = agents.find(a => a.agent_id === agentId);
    if (!agent) {
      console.log(`❌ Agent ${agentId} not found in agents list:`, agents);
      return 'not-found';
    }
    
    // Use same logic and threshold as AgentsTab for consistency
    const lastHbMs = toTs(agent.last_heartbeat);
    const nowMs = Date.now();
    const OFFLINE_THRESHOLD_MS = 20 * 1000; // 20 seconds (same as AgentsTab)
    
    if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      return agent.active ? 'Registered' : 'Discovered';
    }
    
    // If agent exists but heartbeat is stale, still allow job submission but show as discovered
    if (agent.agent_id) {
      console.log(`� Agent ${agentId} exists but heartbeat stale - treating as DISCOVERED`);
      return 'discovered';
    }
    
    console.log(`🔴 Agent ${agentId} is OFFLINE`);
    return 'offline';
  }, [agents]);

  const agentStatus = getAgentStatus(selectedAgent);
  const canSubmit = !selectedAgent || agentStatus === 'Registered';

  // Agent dropdown options
  const agentOptions = [
    { value: '', label: '(Any agent via labels)' },
    ...agents.map(agent => ({
      value: agent.agent_id,
      label: agent.agent_id
    }))
  ];

  const handleAgentSelect = (value) => {
    setSelectedAgent(value);
    setAgentDropdownOpen(false);
  };

  const getAgentLabel = () => {
    const option = agentOptions.find(opt => opt.value === selectedAgent);
    return option ? option.label : '(Any agent via labels)';
  };

  const getStatusBanner = () => {
    if (!selectedAgent) return null;
    
    const status = getAgentStatus(selectedAgent);
    const agentId = selectedAgent;
    
    let message = `Agent status: ${agentId} is `;
    let colorClass = '';
    
    switch (status) {
      case 'Registered':
        message += 'Registered';
        colorClass = 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border-2 border-green-300';
        break;
      case 'Discovered':
        message += 'Discovered';
        colorClass = 'bg-gradient-to-r from-yellow-50 to-amber-50 text-yellow-800 border-2 border-yellow-300';
        break;
      case 'Offline':
        message += 'Offline';
        colorClass = 'bg-gradient-to-r from-red-50 to-pink-50 text-red-700 border-2 border-red-300';
        break;
      case 'not-found':
        message += 'Not Found';
        colorClass = 'bg-gradient-to-r from-red-50 to-pink-50 text-red-700 border-2 border-red-300';
        break;
      default:
        return null;
    }
    
    return { message, colorClass };
  };

  const statusBanner = getStatusBanner();

  const handleCopyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output || '');
      // Could add visual feedback here
    } catch (err) {
      console.error('Failed to copy output:', err);
    }
  };

  const handleSubmit = async () => {
    if (submitting || !canSubmit) return;

    // Stop any existing polling
    setIsPolling(false);
    setCurrentJobId('');
    lastStatusRef.current = null; // Reset status comparison

    setSubmitting(true);
    setOutput('submitting...');
    setBanner({ show: false });

    try {
      // Parse labels
      let labelsObj = {};
      try {
        labelsObj = JSON.parse(labels || '{}');
      } catch (e) {
        throw new Error('Invalid JSON in labels field');
      }

      // Add job-type label for test jobs
      labelsObj['job-type'] = 'test';

      // Prepare payload
      const routingLabels = { ...labelsObj };
      delete routingLabels['job-type']; // Don't use job-type for routing

      const route = selectedAgent ? 
        { agent_id: selectedAgent } : 
        { labels: routingLabels };

      const payload = {
        command: command.trim(),
        labels: labelsObj
      };

      const response = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ job: payload, route })
      });

      const text = await response.text();
      
      // Format initial submission response with timestamp
      const timestamp = new Date().toLocaleTimeString();
      let formattedInitialOutput;
      try {
        const responseObj = JSON.parse(text);
        formattedInitialOutput = `[${timestamp}] Job Submitted:\n${JSON.stringify(responseObj, null, 2)}`;
      } catch {
        formattedInitialOutput = `[${timestamp}] Job Submitted:\n${text}`;
      }
      setOutput(formattedInitialOutput);
      
      // Auto-scroll to bottom
      setTimeout(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      }, 100);

      // Try to extract job ID and agent for persistence
      let jobId = '';
      let submitSuccess = false;
      let pickedAgent = '';
      try {
        const jobObj = JSON.parse(text);
        if (jobObj && jobObj.job_id) {
          jobId = jobObj.job_id;
          submitSuccess = true;
        } else if (jobObj && jobObj.id) {
          jobId = jobObj.id;
          submitSuccess = true;
        }
        // If agent_id is present in response, auto-select it
        if (jobObj && jobObj.agent_id) {
          pickedAgent = jobObj.agent_id;
        }
      } catch {
        // Fallback to regex
        const jobMatch = text.match(/job_id\s*[:=]\s*['\"]?(\w+)["']?/i);
        if (jobMatch) {
          jobId = jobMatch[1];
          submitSuccess = true;
        }
        const agentMatch = text.match(/agent_id\s*[:=]\s*['\"]?(\w+)["']?/i);
        if (agentMatch) {
          pickedAgent = agentMatch[1];
        }
      }

      if (submitSuccess) {
        // If agent was picked automatically, select it in dropdown (use ref to avoid closure issues)
        if (!selectedAgentRef.current && pickedAgent) {
          setSelectedAgent(pickedAgent);
        }
        // Store test job ID
        let testJobIds = [];
        try {
          testJobIds = JSON.parse(localStorage.getItem('testJobIds') || '[]');
        } catch {}
        
        if (!testJobIds.includes(jobId)) {
          testJobIds.push(jobId);
          localStorage.setItem('testJobIds', JSON.stringify(testJobIds));
        }

        // Start polling for this job
        setCurrentJobId(jobId);
        setIsPolling(true);
        
        // Set initial status from submission response
        try {
          const responseObj = JSON.parse(text);
          setCurrentStatus(responseObj.status?.toUpperCase() || 'RUNNING');
        } catch {
          setCurrentStatus('RUNNING');
        }
        
        // Set the initial submission response as the baseline for comparison
        try {
          const responseObj = JSON.parse(text);
          // Normalize values to handle null vs undefined differences
          const meaningfulFields = {
            status: responseObj.status || null,
            rc: responseObj.rc === undefined ? null : responseObj.rc,
            note: responseObj.note || null,
            agent_id: responseObj.agent_id || null,
            job_id: responseObj.job_id || null
          };
          lastStatusRef.current = JSON.stringify(meaningfulFields, null, 2);
          
          // Debug logging
          console.log('Initial baseline set:', lastStatusRef.current);
        } catch {
          // If we can't parse, we'll detect changes on first poll
          lastStatusRef.current = null;
          console.log('Failed to parse submission response, baseline set to null');
        }

        setBanner({
          show: true,
          type: 'success',
          message: 'Job Submitted Successfully'
        });

        // Refresh jobs data
        onJobSubmitted();

        // Auto-hide banner after 2 seconds
        setTimeout(() => setBanner({ show: false }), 2000);
      } else {
        setBanner({
          show: true,
          type: 'error',
          message: 'Job submission failed'
        });
      }
    } catch (error) {
      setOutput(`error: ${error.message}`);
      setBanner({
        show: true,
        type: 'error',
        message: `Job submission failed: ${error.message}`
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl border border-gray-100">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-gray-100">
            <h3 className="text-heading-1 text-primary flex items-center gap-2">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Test A Job
            </h3>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200 flex items-center justify-center"
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Two-column layout */}
          <div className="flex gap-6">
            {/* Left Column - Form */}
            <div className="flex-1 space-y-4">
            {/* Agent status banner */}
            {statusBanner && (
              <div className={`mb-4 p-4 rounded-xl text-body shadow-md hover:shadow-lg transition-all duration-300 ${statusBanner.colorClass}`}>
                <div className="flex items-center gap-3">
                  {getAgentStatus(selectedAgent) === 'registered' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {getAgentStatus(selectedAgent) === 'discovered' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-yellow-100 to-amber-100 border-2 border-yellow-300 flex items-center justify-center">
                      <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                  )}
                  {(getAgentStatus(selectedAgent) === 'offline' || getAgentStatus(selectedAgent) === 'not-found') && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                  <span className="font-medium text-body-large">{statusBanner.message}</span>
                </div>
              </div>
            )}

            {/* Agent selector */}
            <div className="space-y-1">
              <label className="form-label text-body-large font-semibold">Target Agent</label>
              <div className="relative" ref={agentDropdownRef}>
                <button 
                  onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 pr-10 bg-white border border-blue-200 rounded-lg text-lg font-semibold text-gray-900 hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer w-full text-left"
                >
                  <span>{getAgentLabel()}</span>
                </button>
                <svg className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none transition-transform duration-200 ${agentDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {agentDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-full bg-white border border-blue-200 rounded-lg shadow-lg z-50 overflow-hidden">
                    {agentOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => handleAgentSelect(option.value)}
                        className={`w-full text-left px-4 py-4 text-lg font-semibold transition-all duration-150 ${
                          selectedAgent === option.value 
                            ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' 
                            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                      >
                        {option.label}
                        {selectedAgent === option.value && (
                          <span className="ml-auto flex items-center">
                            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Command input */}
            <div className="space-y-1">
              <label className="form-label text-body-large font-semibold">Command</label>
              <textarea 
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2.5 w-full text-mono-large focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 resize-vertical" 
                rows="4"
                placeholder="Command to run (supports multiline commands)"
              />
            </div>

            {/* Labels input */}
            <div className="space-y-1">
              <label className="form-label text-body-large font-semibold">Labels (JSON)</label>
              <textarea 
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2.5 w-full text-mono-large focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200" 
                rows="3"
                placeholder='{} (or {"os":"linux"})'
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button 
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-body-large font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow-md ${
                  canSubmit && !submitting 
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {submitting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Submit Job
                  </>
                )}
              </button>
              <button 
                onClick={onJobsTabClick}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-body-large font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                </svg>
                Show All Jobs
              </button>
            </div>

            {/* Submit status banner */}
            {banner.show && (
              <div className={`mt-4 p-4 rounded-xl text-body shadow-md hover:shadow-lg transition-all duration-300 ${
                banner.type === 'success' 
                  ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border-2 border-green-300'
                  : 'bg-gradient-to-r from-red-50 to-pink-50 text-red-800 border-2 border-red-300'
              }`}>
                <div className="flex items-center gap-3">
                  {banner.type === 'success' ? (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                  <span className="font-medium text-body-large">{banner.message}</span>
                </div>
              </div>
            )}
            </div>

            {/* Right Column - Output */}
            <div className="flex-1 space-y-3">
            
            {/* Enhanced State Diagram */}
            {currentJobId && (
              <div className="mb-6">
                <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-xl p-6 shadow-lg">
                  <div className="text-center mb-4">
                    <h3 className="text-sm font-bold text-slate-700 tracking-wide">JOB EXECUTION PIPELINE</h3>
                  </div>
                  <div className="flex items-center justify-center space-x-8">
                    {/* SUBMITTED Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        currentStatus === 'SUBMITTED' 
                          ? 'bg-gradient-to-br from-blue-400 to-blue-600 shadow-xl scale-110 animate-pulse' 
                          : ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) 
                            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg' 
                            : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {/* Outer glow ring */}
                        {currentStatus === 'SUBMITTED' && (
                          <div className="absolute inset-0 rounded-full bg-blue-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {currentStatus === 'SUBMITTED' ? (
                          <div className="relative">
                            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        ) : ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        currentStatus === 'SUBMITTED' ? 'text-blue-700' : 
                        ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? 'text-emerald-700' : 'text-slate-600'
                      }`}>
                        SUBMITTED
                      </span>
                      {currentStatus === 'SUBMITTED' && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                        </div>
                      )}
                    </div>
                    
                    {/* Advanced Arrow 1 */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-12 h-1 bg-slate-300 rounded-full overflow-hidden">
                        {['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) && (
                          <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-700 animate-pulse" style={{width: '100%'}}></div>
                        )}
                      </div>
                      <svg className={`w-4 h-4 mt-1 transition-colors duration-500 ${
                        ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? 'text-emerald-500' : 'text-slate-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* RUNNING Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        currentStatus === 'RUNNING' 
                          ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl scale-110 animate-pulse' 
                          : ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) 
                            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg' 
                            : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {/* Outer glow ring for running */}
                        {currentStatus === 'RUNNING' && (
                          <div className="absolute inset-0 rounded-full bg-amber-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {currentStatus === 'RUNNING' ? (
                          <div className="relative">
                            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        ) : ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l4.828 4.828a1 1 0 01.293.707V17a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1.586a1 1 0 01.293-.707L16.414 13a1 1 0 01.707-.293H19a1 1 0 001-1V9a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293L12.879 3.879A1 1 0 0012.172 3.586L11 5" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        currentStatus === 'RUNNING' ? 'text-amber-700' : 
                        ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? 'text-emerald-700' : 'text-slate-600'
                      }`}>
                        RUNNING
                      </span>
                      {currentStatus === 'RUNNING' && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                        </div>
                      )}
                    </div>
                    
                    {/* Advanced Arrow 2 */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-12 h-1 bg-slate-300 rounded-full overflow-hidden">
                        {['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) && (
                          <div className={`absolute top-0 left-0 h-full rounded-full transition-all duration-700 animate-pulse ${
                            currentStatus === 'SUCCEEDED' ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' :
                            currentStatus === 'FAILED' ? 'bg-gradient-to-r from-red-400 to-red-600' :
                            'bg-gradient-to-r from-orange-400 to-orange-600'
                          }`} style={{width: '100%'}}></div>
                        )}
                      </div>
                      <svg className={`w-4 h-4 mt-1 transition-colors duration-500 ${
                        ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) ? 
                          currentStatus === 'SUCCEEDED' ? 'text-emerald-500' :
                          currentStatus === 'FAILED' ? 'text-red-500' : 'text-orange-500'
                        : 'text-slate-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* COMPLETED Stage */}
                    <div className="flex flex-col items-center relative">
                      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 transform ${
                        currentStatus === 'SUCCEEDED' 
                          ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-xl scale-110' 
                        : currentStatus === 'FAILED' 
                          ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-xl scale-110' 
                        : currentStatus === 'CANCELLED' 
                          ? 'bg-gradient-to-br from-orange-400 to-orange-600 shadow-xl scale-110' 
                          : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-md'
                      }`}>
                        {/* Success celebration ring */}
                        {currentStatus === 'SUCCEEDED' && (
                          <div className="absolute inset-0 rounded-full bg-emerald-400 opacity-30 animate-ping"></div>
                        )}
                        {currentStatus === 'FAILED' && (
                          <div className="absolute inset-0 rounded-full bg-red-400 opacity-30 animate-ping"></div>
                        )}
                        {currentStatus === 'CANCELLED' && (
                          <div className="absolute inset-0 rounded-full bg-orange-400 opacity-30 animate-ping"></div>
                        )}
                        
                        {currentStatus === 'SUCCEEDED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : currentStatus === 'FAILED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : currentStatus === 'CANCELLED' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs mt-3 font-bold tracking-wider ${
                        currentStatus === 'SUCCEEDED' ? 'text-emerald-700' :
                        currentStatus === 'FAILED' ? 'text-red-700' :
                        currentStatus === 'CANCELLED' ? 'text-orange-700' : 'text-slate-600'
                      }`}>
                        {currentStatus === 'SUCCEEDED' ? 'SUCCEEDED' :
                         currentStatus === 'FAILED' ? 'FAILED' :
                         currentStatus === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED'}
                      </span>
                      {['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentStatus) && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className={`w-2 h-2 rounded-full animate-bounce ${
                            currentStatus === 'SUCCEEDED' ? 'bg-emerald-500' :
                            currentStatus === 'FAILED' ? 'bg-red-500' : 'bg-orange-500'
                          }`} style={{animationDelay: '0.2s'}}></div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Status message */}
                  <div className="text-center mt-4">
                    <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                      currentStatus === 'SUBMITTED' ? 'bg-blue-100 text-blue-800' :
                      currentStatus === 'RUNNING' ? 'bg-amber-100 text-amber-800' :
                      currentStatus === 'SUCCEEDED' ? 'bg-emerald-100 text-emerald-800' :
                      currentStatus === 'FAILED' ? 'bg-red-100 text-red-800' :
                      currentStatus === 'CANCELLED' ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        currentStatus === 'SUBMITTED' ? 'bg-blue-400 animate-pulse' :
                        currentStatus === 'RUNNING' ? 'bg-amber-400 animate-pulse' :
                        currentStatus === 'SUCCEEDED' ? 'bg-emerald-400' :
                        currentStatus === 'FAILED' ? 'bg-red-400' :
                        currentStatus === 'CANCELLED' ? 'bg-orange-400' : 'bg-slate-400'
                      }`}></div>
                      Current Status: {currentStatus || 'PENDING'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-3 mb-3">
              <label className="form-label text-body-large font-semibold">Output</label>
              {isPolling && (
                <div className="flex items-center gap-2 text-blue-600">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-sm font-medium">Live Updates</span>
                  <span className="text-xs text-gray-500">(only when changed)</span>
                </div>
              )}
            </div>
            
            {/* Output container with floating buttons */}
            <div className="relative">
              <pre 
                ref={outputRef}
                className="p-4 pt-12 rounded-lg border border-gray-200 overflow-auto text-mono whitespace-pre-wrap break-words bg-gray-900 text-green-400 shadow-inner"
                style={{ height: '520px' }}
              >
                {output || 'No output yet...'}
              </pre>
              
              {/* Floating buttons overlay */}
              <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                {currentJobId && (
                  <button 
                    onClick={() => setIsPolling(!isPolling)}
                    className={`inline-flex items-center gap-2 px-3 py-2 border text-body font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 ${
                      isPolling 
                        ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100 hover:border-red-400'
                        : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100 hover:border-green-400'
                    }`}
                    title={isPolling ? "Stop live updates" : "Start live updates"}
                  >
                    {isPolling ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                        Stop
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l4.828 4.828a1 1 0 01.293.707V17a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1.586a1 1 0 01.293-.707L16.414 13a1 1 0 01.707-.293H19a1 1 0 001-1V9a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293L12.879 3.879A1 1 0 0012.172 3.586L11 5a1 1 0 01-1.707.707L7.586 4a1 1 0 01-.293-.707L8 2a1 1 0 00-1-1H5a1 1 0 00-1 1v2.172a1 1 0 01-.293.707L1.879 7.707A1 1 0 001.586 8.414L3 10a1 1 0 001 1h2.172a1 1 0 01.707.293L9.707 14.121A1 1 0 0010.414 14.828z" />
                        </svg>
                        Refresh
                      </>
                    )}
                  </button>
                )}
                <button 
                  onClick={() => setOutput('')}
                  disabled={!output || output === 'submitting...'}
                  className={`inline-flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-300 text-orange-700 text-body font-semibold rounded-lg hover:bg-orange-100 hover:border-orange-400 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-1 ${
                    !output || output === 'submitting...' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  title="Clear output log"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear
                </button>
                <button 
                  onClick={handleCopyOutput}
                  disabled={!output || output === 'submitting...'}
                  className={`inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 text-body font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 ${
                    !output || output === 'submitting...' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  title="Copy output"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 002 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmitJobDialog;