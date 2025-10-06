import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE, getAuthHeaders } from '../utils/api';

const SubmitJobDialog = ({ 
  agents, 
  preselectedAgent, 
  onClose, 
  onJobsTabClick, 
  onJobSubmitted 
}) => {
  const [selectedAgent, setSelectedAgent] = useState(preselectedAgent || '');
  const [command, setCommand] = useState('echo HELLO && sleep 2 && echo DONE');
  const [labels, setLabels] = useState('{}');
  const [output, setOutput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState({ show: false, message: '', type: 'info' });
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef(null);

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

  // Determine agent status for validation
  const getAgentStatus = useCallback((agentId) => {
    if (!agentId) return null;
    
    const agent = agents.find(a => a.agent_id === agentId);
    if (!agent) return 'not-found';
    
    const lastHbMs = agent.last_heartbeat ? Date.parse(agent.last_heartbeat) : 0;
    const nowMs = Date.now();
    const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
    
    if (agent.active && lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      return 'registered';
    } else if (lastHbMs && (nowMs - lastHbMs < OFFLINE_THRESHOLD_MS)) {
      return 'discovered';
    }
    return 'offline';
  }, [agents]);

  const agentStatus = getAgentStatus(selectedAgent);
  const canSubmit = !selectedAgent || agentStatus === 'registered';

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
      case 'registered':
        message += 'Registered';
        colorClass = 'bg-green-50 text-green-800 border border-green-200';
        break;
      case 'discovered':
        message += 'Discovered';
        colorClass = 'bg-yellow-50 text-yellow-800 border border-yellow-200';
        break;
      case 'offline':
        message += 'Offline';
        colorClass = 'bg-red-50 text-red-700 border border-red-200';
        break;
      case 'not-found':
        message += 'Not Found';
        colorClass = 'bg-red-50 text-red-700 border border-red-200';
        break;
      default:
        return null;
    }
    
    return { message, colorClass };
  };

  const statusBanner = getStatusBanner();

  const handleSubmit = async () => {
    if (submitting || !canSubmit) return;

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
      setOutput(text);

      // Try to extract job ID for persistence
      let jobId = '';
      let submitSuccess = false;
      try {
        const jobObj = JSON.parse(text);
        if (jobObj && jobObj.job_id) {
          jobId = jobObj.job_id;
          submitSuccess = true;
        } else if (jobObj && jobObj.id) {
          jobId = jobObj.id;
          submitSuccess = true;
        }
      } catch {
        // Fallback to regex
        const jobMatch = text.match(/job_id\s*[:=]\s*['\"]?(\w+)["']?/i);
        if (jobMatch) {
          jobId = jobMatch[1];
          submitSuccess = true;
        }
      }

      if (submitSuccess) {
        // Store test job ID
        let testJobIds = [];
        try {
          testJobIds = JSON.parse(localStorage.getItem('testJobIds') || '[]');
        } catch {}
        
        if (!testJobIds.includes(jobId)) {
          testJobIds.push(jobId);
          localStorage.setItem('testJobIds', JSON.stringify(testJobIds));
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-gray-100">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-gray-100">
            <h3 className="text-heading-2 text-primary flex items-center gap-2">
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

          {/* Form */}
          <div className="space-y-2">
            {/* Agent status banner */}
            {statusBanner && (
              <div className={`mb-2 px-3 py-2 rounded text-sm ${statusBanner.colorClass}`}>
                {statusBanner.message}
              </div>
            )}

            {/* Agent selector */}
            <div className="space-y-1">
              <label className="form-label">Target Agent</label>
              <div className="relative" ref={agentDropdownRef}>
                <button
                  onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                  className="border border-gray-300 rounded-lg px-3 py-2.5 w-full text-body text-gray-900 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 cursor-pointer hover:border-gray-400 text-left flex items-center justify-between"
                >
                  <span>{getAgentLabel()}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${agentDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {agentDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    {agentOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => handleAgentSelect(option.value)}
                        className={`w-full text-left px-3 py-2.5 text-sm transition-all duration-150 hover:bg-blue-50 hover:text-blue-900 ${
                          selectedAgent === option.value 
                            ? 'bg-blue-100 text-blue-900 font-medium' 
                            : 'text-gray-700'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Command input */}
            <div className="space-y-1">
              <label className="form-label">Command</label>
              <input 
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2.5 w-full text-body focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200" 
                placeholder="Command to run"
              />
            </div>

            {/* Labels input */}
            <div className="space-y-1">
              <label className="form-label">Labels (JSON)</label>
              <textarea 
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2.5 w-full text-body focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 text-mono" 
                rows="3"
                placeholder='{} (or {"os":"linux"})'
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button 
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
                className={`inline-flex items-center gap-2 px-4 py-2.5 btn-text rounded-lg transition-all duration-200 shadow-sm hover:shadow-md ${
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
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                </svg>
                Show All Jobs
              </button>
            </div>

            {/* Submit status banner */}
            {banner.show && (
              <div className={`mt-2 text-sm px-3 py-2 rounded ${
                banner.type === 'success' 
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {banner.message}
              </div>
            )}
          </div>

          {/* Output */}
          <div className="space-y-1">
            <label className="form-label">Output</label>
            <pre 
              className="p-4 rounded-lg border border-gray-200 overflow-auto h-32 text-mono-small whitespace-pre-wrap break-words bg-gray-900 text-green-400 shadow-inner"
            >
              {output || 'No output yet...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmitJobDialog;