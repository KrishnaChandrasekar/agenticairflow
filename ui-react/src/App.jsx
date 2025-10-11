import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import TabNavigation from './components/TabNavigation';
import JobsTab from './components/JobsTab';
import AgentsTab from './components/AgentsTab';
import AnalyticsTab from './components/AnalyticsTab';
import SecurityTab from './components/SecurityTab';
import JobDrawer from './components/JobDrawer';
import SubmitJobDialog from './components/SubmitJobDialog';
import ErrorBanner from './components/ErrorBanner';
import LoginPage from './components/LoginPage';
import { useJobs, useAgents, useTimezone, useTimeRange } from './hooks/useData';
import { API_BASE } from './utils/api';

function App() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState(null);
  const [showJobDrawer, setShowJobDrawer] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [preselectedAgent, setPreselectedAgent] = useState('');
  
  // Authentication state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  // Data hooks - only fetch data for active tabs when user is authenticated
  const shouldFetchJobs = autoRefresh && user && (activeTab === 'jobs' || activeTab === 'analytics');
  const shouldFetchAgents = autoRefresh && user && (activeTab === 'agents' || activeTab === 'analytics');
  
  const { jobs, loading: jobsLoading, error: jobsError, refreshJobs } = useJobs(shouldFetchJobs);
  const { agents, loading: agentsLoading, error: agentsError, refreshAgents } = useAgents(shouldFetchAgents);
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
      await refreshAgents();
      // Trigger analytics refresh with animation
      window.dispatchEvent(new CustomEvent('analyticsRefresh', { detail: { animate: true } }));
    } else if (activeTab === 'jobs') {
      await refreshJobs();
    } else if (activeTab === 'agents') {
      await refreshAgents();
    }
    // Security tab doesn't need jobs/agents data refresh
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

  // Show loading spinner while checking authentication
  if (authLoading) {
    return (
      <div className="bg-slate-50 text-slate-800 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen">
      <div className="max-w-screen-2xl mx-auto p-4 space-y-4">
        <Header
          timezone={timezone}
          onTimezoneChange={updateTimezone}
          onResetToLocal={resetToLocal}
          onClearCache={clearTimezoneCache}
          onSubmitJobClick={() => openSubmitDialog()}
          user={user}
          onLogout={() => setUser(null)}
        />

        {currentError && (
          <ErrorBanner 
            message={currentError} 
            onClose={() => setError(null)} 
          />
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow p-4 min-h-[calc(100vh-8rem)] h-fit">
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

            {activeTab === 'security' && (
              <SecurityTab
                user={user}
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