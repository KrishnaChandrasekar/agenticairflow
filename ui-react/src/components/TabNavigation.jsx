import { useState, useRef, useEffect } from 'react';

const TabNavigation = ({ 
  activeTab, 
  onTabChange, 
  autoRefresh, 
  onAutoRefreshChange, 
  onManualRefresh, 
  timeRange,
  onTimeRangeChange,
  loading 
}) => {
  const [showTimeRangeMenu, setShowTimeRangeMenu] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowTimeRangeMenu(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowTimeRangeMenu(false);
      }
    };

    if (showTimeRangeMenu) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      
      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showTimeRangeMenu]);

  const formatRangeLabel = () => {
    const fieldLabel = timeRange.field === 'created_at' ? 'Created' : 'Updated';
    if (!timeRange.enabled) return `${fieldLabel}: All time`;
    
    if (timeRange.mode === 'relative') {
      const mins = timeRange.relMins;
      let rangeText = '';
      if (mins % (24 * 60) === 0) rangeText = `Last ${mins / (24 * 60)}d`;
      else if (mins % 60 === 0) rangeText = `Last ${mins / 60}h`;
      else rangeText = `Last ${mins}m`;
      return `${fieldLabel} in ${rangeText}`;
    } else {
      const f = (ms) => new Date(ms).toLocaleString();
      const { fromMs, toMs } = timeRange.abs;
      const fromText = fromMs ? f(fromMs) : '–';
      const toText = toMs ? f(toMs) : 'Now';
      return `${fieldLabel} from ${fromText} → ${toText}`;
    }
  };

  const handleQuickRange = (mins) => {
    onTimeRangeChange({
      enabled: true,
      mode: 'relative',
      relMins: mins
    });
    setShowTimeRangeMenu(false);
  };

  const handleTodayYesterday = (isToday) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!isToday) {
      start.setDate(start.getDate() - 1);
    }
    const end = isToday ? now.getTime() : start.getTime() + 24 * 60 * 60 * 1000 - 1;
    
    onTimeRangeChange({
      enabled: true,
      mode: 'absolute',
      abs: { fromMs: start.getTime(), toMs: end }
    });
    setShowTimeRangeMenu(false);
  };

  const handleFieldChange = (field) => {
    onTimeRangeChange({ field });
  };

  const handleClearTimeRange = () => {
    onTimeRangeChange({ enabled: false });
    setShowTimeRangeMenu(false);
  };

  const handleApplyAbsolute = () => {
    const fromInput = document.getElementById('tr-from-shared');
    const toInput = document.getElementById('tr-to-shared');
    const fromMs = fromInput?.value ? Date.parse(fromInput.value) : null;
    const toMs = toInput?.value ? Date.parse(toInput.value) : null;
    
    onTimeRangeChange({
      enabled: true,
      mode: 'absolute',
      abs: { fromMs, toMs }
    });
    setShowTimeRangeMenu(false);
  };

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-gray-50 to-slate-50">
      <div className="flex items-center">
        <button 
          onClick={() => onTabChange('jobs')}
          className={`inline-flex items-center gap-3 px-6 py-4 font-semibold text-lg rounded-t-xl border-b-4 transition-all duration-200 ${
            activeTab === 'jobs' 
              ? 'text-blue-700 border-blue-600 bg-gradient-to-t from-white to-blue-50 shadow-md' 
              : 'text-gray-700 border-transparent hover:text-gray-900 hover:border-gray-400 hover:bg-gradient-to-t hover:from-gray-50 hover:to-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          Jobs
        </button>
        <button 
          onClick={() => onTabChange('agents')}
          className={`inline-flex items-center gap-3 px-6 py-4 font-semibold text-lg rounded-t-xl border-b-4 transition-all duration-200 ${
            activeTab === 'agents' 
              ? 'text-blue-700 border-blue-600 bg-gradient-to-t from-white to-blue-50 shadow-md' 
              : 'text-gray-700 border-transparent hover:text-gray-900 hover:border-gray-400 hover:bg-gradient-to-t hover:from-gray-50 hover:to-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Agents
        </button>
        <button 
          onClick={() => onTabChange('analytics')}
          className={`inline-flex items-center gap-3 px-6 py-4 font-semibold text-lg rounded-t-xl border-b-4 transition-all duration-200 ${
            activeTab === 'analytics' 
              ? 'text-blue-700 border-blue-600 bg-gradient-to-t from-white to-blue-50 shadow-md' 
              : 'text-gray-700 border-transparent hover:text-gray-900 hover:border-gray-400 hover:bg-gradient-to-t hover:from-gray-50 hover:to-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
          </svg>
          Analytics
        </button>
        <button 
          onClick={() => onTabChange('security')}
          className={`inline-flex items-center gap-3 px-6 py-4 font-semibold text-lg rounded-t-xl border-b-4 transition-all duration-200 ${
            activeTab === 'security' 
              ? 'text-blue-700 border-blue-600 bg-gradient-to-t from-white to-blue-50 shadow-md' 
              : 'text-gray-700 border-transparent hover:text-gray-900 hover:border-gray-400 hover:bg-gradient-to-t hover:from-gray-50 hover:to-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Security
        </button>
      </div>

      {/* DEBUG: Show active tab */}
      {activeTab !== 'security' ? (
      <div className="flex items-center gap-3">
        {/* Auto Refresh and Time Filter controls */}
            {/* Auto Refresh Toggle */}
            <div className="flex items-center gap-3 bg-white/70 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-2 shadow-sm hover:shadow-md transition-all duration-200">
          <label className="form-label flex items-center gap-2 cursor-pointer">
            <div className="relative">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={autoRefresh}
                onChange={(e) => onAutoRefreshChange(e.target.checked)}
              />
              <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-blue-500 peer-checked:to-indigo-600 shadow-inner"></div>
            </div>
            <div className="flex flex-col">
              <span className="text-body-medium text-gray">Auto Refresh</span>
              <span className="text-body-small text-tertiary">Updates every 2s</span>
            </div>
          </label>
          
          {/* Manual Refresh Button */}
          <div className="flex items-center">
            <div className="w-px h-8 bg-slate-200 mx-2"></div>
            <button 
              onClick={onManualRefresh}
              disabled={autoRefresh}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg btn-text-small transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                autoRefresh 
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 border border-slate-200 text-slate-400' 
                  : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-sm hover:shadow-md border border-emerald-500'
              }`}
              title={autoRefresh ? "Auto refresh is enabled" : "Refresh data now"}
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Time Filter */}
        <div className="relative">
            <button 
              ref={buttonRef}
              onClick={() => setShowTimeRangeMenu(!showTimeRangeMenu)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                timeRange.enabled 
                  ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-blue-800 shadow-sm hover:shadow-md hover:from-blue-100 hover:to-indigo-100 hover:border-blue-300' 
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
              }`}
            >
            {timeRange.enabled && (
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
            )}
            <span>{formatRangeLabel()}</span>
            <svg className={`w-4 h-4 transition-transform duration-200 ${
              showTimeRangeMenu ? 'rotate-180' : ''
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showTimeRangeMenu && (
            <div 
              ref={menuRef}
              className="absolute right-0 z-50 mt-2 w-[32rem] bg-white border border-gray-200 rounded-xl shadow-xl p-4 space-y-4 backdrop-blur-sm bg-white/95"
              style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}
            >
              <div className="bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-200 rounded-lg p-4">
                <div className="text-heading-3 text-primary mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1.707.293l5.414 5.414a1 1 0 0 1.293.707V19a2 2 0 0 1-2 2z" />
                  </svg>
                  <span>Time Field</span>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input 
                        type="radio" 
                        name="tr-field-shared" 
                        value="updated_at" 
                        checked={timeRange.field === 'updated_at'}
                        onChange={(e) => handleFieldChange(e.target.value)}
                        className="sr-only peer"
                      />
                      <div className="w-5 h-5 border-2 border-slate-300 rounded-full peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-focus:ring-2 peer-focus:ring-blue-300 transition-all duration-200 flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full opacity-0 peer-checked:opacity-100 transition-opacity duration-200"></div>
                      </div>
                    </div>
                    <span className="form-label text-primary group-hover:text-accent transition-colors">Updated At</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input 
                        type="radio" 
                        name="tr-field-shared" 
                        value="created_at"
                        checked={timeRange.field === 'created_at'}
                        onChange={(e) => handleFieldChange(e.target.value)}
                        className="sr-only peer"
                      />
                      <div className="w-5 h-5 border-2 border-slate-300 rounded-full peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-focus:ring-2 peer-focus:ring-blue-300 transition-all duration-200 flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full opacity-0 peer-checked:opacity-100 transition-opacity duration-200"></div>
                      </div>
                    </div>
                    <span className="form-label text-primary group-hover:text-accent transition-colors">Created At</span>
                  </label>
                </div>
              </div>

              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                <div className="text-heading-3 text-primary mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Quick Ranges</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <button onClick={() => handleQuickRange(15)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 15m</button>
                  <button onClick={() => handleQuickRange(60)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 1h</button>
                  <button onClick={() => handleQuickRange(240)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 4h</button>
                  <button onClick={() => handleQuickRange(1440)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 24h</button>
                  <button onClick={() => handleQuickRange(10080)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 7d</button>
                  <button onClick={() => handleQuickRange(43200)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 rounded-lg text-green-800 hover:from-green-200 hover:to-emerald-200 hover:border-green-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-300">Last 30d</button>
                  <button onClick={() => handleTodayYesterday(true)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-purple-100 to-violet-100 border border-purple-300 rounded-lg text-purple-800 hover:from-purple-200 hover:to-violet-200 hover:border-purple-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-300">Today</button>
                  <button onClick={() => handleTodayYesterday(false)} className="btn-text-small px-3 py-2.5 bg-gradient-to-r from-purple-100 to-violet-100 border border-purple-300 rounded-lg text-purple-800 hover:from-purple-200 hover:to-violet-200 hover:border-purple-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-300">Yesterday</button>
                </div>
              </div>

              <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-4">
                <div className="text-heading-3 text-primary mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
                  </svg>
                  <span>Absolute Range</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label text-primary mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      From Date
                    </label>
                    <input 
                      id="tr-from-shared"
                      type="datetime-local" 
                      className="w-full px-3 py-2.5 border-2 border-orange-200 rounded-lg focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-all duration-200 bg-white/70 hover:bg-white hover:border-orange-300 text-body shadow-sm backdrop-blur-sm"
                    />
                  </div>
                  <div>
                    <label className="form-label text-primary mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      To Date
                    </label>
                    <input 
                      id="tr-to-shared"
                      type="datetime-local" 
                      className="w-full px-3 py-2.5 border-2 border-orange-200 rounded-lg focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-all duration-200 bg-white/70 hover:bg-white hover:border-orange-300 text-body shadow-sm backdrop-blur-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t-2 border-slate-200">
                <button 
                  onClick={handleClearTimeRange}
                  className="inline-flex items-center gap-2 px-4 py-2.5 btn-text text-red-700 bg-gradient-to-r from-red-100 to-pink-100 border-2 border-red-300 rounded-lg hover:from-red-200 hover:to-pink-200 hover:border-red-400 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                  <span>Clear All</span>
                </button>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setShowTimeRangeMenu(false)}
                    className="px-4 py-2.5 btn-text text-secondary bg-white border-2 border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all duration-200 focus:ring-2 focus:ring-slate-300 shadow-sm hover:shadow-md"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleApplyAbsolute}
                    className="inline-flex items-center gap-2 px-4 py-2.5 btn-text text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg focus:ring-2 focus:ring-blue-500 border border-blue-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Apply Range</span>
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
      </div>
      ) : null}
    </div>
  );
};

export default TabNavigation;