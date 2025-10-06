import { useState, useCallback } from 'react';
import Header from './components/Header';
import TabNavigation from './components/TabNavigation';
import JobsTab from './components/JobsTab';
import AgentsTab from './components/AgentsTab';
import AnalyticsTab from './components/AnalyticsTab';
import JobDrawer from './components/JobDrawer';
import SubmitJobDialog from './components/SubmitJobDialog';
import ErrorBanner from './components/ErrorBanner';
import { useJobs, useAgents, useTimezone, useTimeRange } from './hooks/useData';

function App() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState(null);
  const [showJobDrawer, setShowJobDrawer] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [preselectedAgent, setPreselectedAgent] = useState('');

  // Data hooks
  const { jobs, loading: jobsLoading, error: jobsError, refreshJobs } = useJobs(autoRefresh);
  const { agents, loading: agentsLoading, error: agentsError, refreshAgents } = useAgents(autoRefresh);
  const { timezone, updateTimezone, resetToLocal, clearTimezoneCache } = useTimezone();
  const { timeRange, updateTimeRange, filterJobsByTime } = useTimeRange();

  // Handle errors from hooks
  const allErrors = [jobsError, agentsError, error].filter(Boolean);
  const currentError = allErrors[0];

  const handleManualRefresh = useCallback(async () => {
    setError(null);
    if (activeTab === 'analytics') {
      // For analytics, we want to animate the charts
      await refreshJobs();
      // Trigger analytics refresh with animation
      window.dispatchEvent(new CustomEvent('analyticsRefresh', { detail: { animate: true } }));
    } else {
      await Promise.all([refreshJobs(), refreshAgents()]);
    }
  }, [activeTab, refreshJobs, refreshAgents]);

  const openJobDrawer = useCallback((jobId) => {
    setSelectedJobId(jobId);
    setShowJobDrawer(true);
  }, []);

  const closeJobDrawer = useCallback(() => {
    setShowJobDrawer(false);
    setSelectedJobId(null);
  }, []);

  const openSubmitDialog = useCallback((agentId = '') => {
    setPreselectedAgent(agentId);
    setShowSubmitDialog(true);
  }, []);

  const closeSubmitDialog = useCallback(() => {
    setShowSubmitDialog(false);
    setPreselectedAgent('');
  }, []);

  const switchToJobsTab = useCallback(() => {
    setActiveTab('jobs');
    closeSubmitDialog();
  }, [closeSubmitDialog]);

  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen">
      <div className="max-w-screen-2xl mx-auto p-4 space-y-4">
        <Header
          timezone={timezone}
          onTimezoneChange={updateTimezone}
          onResetToLocal={resetToLocal}
          onClearCache={clearTimezoneCache}
          onSubmitJobClick={() => openSubmitDialog()}
        />

        {currentError && (
          <ErrorBanner 
            message={currentError} 
            onClose={() => setError(null)} 
          />
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow p-4">
            <TabNavigation
              activeTab={activeTab}
              onTabChange={setActiveTab}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
              onManualRefresh={handleManualRefresh}
              timeRange={timeRange}
              onTimeRangeChange={updateTimeRange}
              loading={jobsLoading || agentsLoading}
            />

            {activeTab === 'jobs' && (
              <JobsTab
                jobs={jobs}
                timezone={timezone}
                timeRange={timeRange}
                filterJobsByTime={filterJobsByTime}
                onJobClick={openJobDrawer}
                onTimeRangeClear={() => updateTimeRange({ enabled: false })}
                loading={jobsLoading}
              />
            )}

            {activeTab === 'agents' && (
              <AgentsTab
                agents={agents}
                jobs={jobs}
                timezone={timezone}
                timeRange={timeRange}
                filterJobsByTime={filterJobsByTime}
                onTestJobClick={openSubmitDialog}
                loading={agentsLoading}
                refreshAgents={refreshAgents}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsTab
                jobs={jobs}
                filterJobsByTime={filterJobsByTime}
                autoRefresh={autoRefresh}
                timezone={timezone}
              />
            )}
          </div>
        </section>
      </div>

      {showJobDrawer && (
        <JobDrawer
          jobId={selectedJobId}
          jobs={jobs}
          timezone={timezone}
          onClose={closeJobDrawer}
        />
      )}

      {showSubmitDialog && (
        <SubmitJobDialog
          agents={agents}
          preselectedAgent={preselectedAgent}
          onClose={closeSubmitDialog}
          onJobsTabClick={switchToJobsTab}
          onJobSubmitted={refreshJobs}
        />
      )}
    </div>
  );
}

export default App;