import { useState, useRef, useEffect } from 'react';
import SpikeGraphLogo from './SpikeGraphLogo';
import { getSupportedTimezones, formatTzLabel, API_BASE } from '../utils/api';

const Header = ({ timezone, onTimezoneChange, onResetToLocal, onClearCache, onSubmitJobClick, user, onLogout }) => {
  const [showTzMenu, setShowTzMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const userMenuRef = useRef(null);
  const userButtonRef = useRef(null);

  const timezones = getSupportedTimezones();

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      
    } finally {
      onLogout();
      setShowUserMenu(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowTzMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target) && 
          userButtonRef.current && !userButtonRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowTzMenu(false);
        setShowUserMenu(false);
      }
    };

    if (showTzMenu || showUserMenu) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      
      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showTzMenu, showUserMenu]);

  const handleTimezoneClick = (tz) => {
    onTimezoneChange(tz);
    setShowTzMenu(false);
  };

  const resetToLocalTimezone = () => {
    if (onResetToLocal) {
      const result = onResetToLocal();
      if (result) {
        setShowTzMenu(false);
      }
    }
  };

  const toggleTzMenu = () => {
    setShowTzMenu(prev => !prev);
  };

  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-4 ml-4">
        <SpikeGraphLogo size={56} />
        <h1 className="text-display text-primary cursor-pointer transition-colors duration-200 hover:text-accent" style={{ color: '#143d6b' }}>
          Agent Router Monitoring Console
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {/* Timezone selector */}
        <div className="relative">
          <button 
            ref={buttonRef}
            onClick={toggleTzMenu}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-blue-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm hover:shadow-md transition-all duration-200"
          >
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{formatTzLabel(timezone)}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showTzMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showTzMenu && (
            <div 
              ref={menuRef}
              className="absolute top-full right-0 mt-2 w-80 max-h-72 overflow-auto bg-gradient-to-r from-blue-25 to-indigo-25 border border-blue-200 rounded-lg shadow-lg z-50 backdrop-blur-sm"
            >
              {/* Reset to Local Timezone Option */}
              <button
                type="button"
                onClick={resetToLocalTimezone}
                className="w-full text-left px-4 py-3 hover:bg-blue-100/60 border-b border-blue-200 text-blue-700 font-medium flex items-center transition-all duration-150"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="mr-2">
                  <path fillRule="evenodd" d="M4 2a1 1 0 0 1 1 1v2.101a7.002 7.002 0 0 1 11.601 2.566 1 1 0 1 1-1.885.666A5.002 5.002 0 0 0 5.999 7H9a1 1 0 0 1 0 2H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm.008 9.057a1 1 0 0 1 1.276.61A5.002 5.002 0 0 0 14.001 13H11a1 1 0 1 1 0-2h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-2.101a7.002 7.002 0 0 1-11.601-2.566 1 1 0 0 1.61-1.276z" clipRule="evenodd" />
                </svg>
                Reset to Local Timezone
              </button>
              
              {/* Debug: Clear Cache Option */}
              {onClearCache && (
                <button
                  type="button"
                  onClick={() => {
                    onClearCache();
                    setShowTzMenu(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-orange-100/60 border-b border-blue-200 text-orange-700 font-medium flex items-center transition-all duration-150"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="mr-2">
                    <path fillRule="evenodd" d="M9 2a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2H9z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.707-8.293l-3-3a1 1 0 0 0-1.414 1.414L10.586 9.5H7a1 1 0 1 0 0 2h3.586l-1.293 1.293a1 1 0 1 0 1.414 1.414l3-3a1 1 0 0 0 0-1.414z" clipRule="evenodd" />
                  </svg>
                  🔧 Force Refresh Timezone
                </button>
              )}
              
              {timezones.map((tz, index) => {
                const isLocal = index === 0; // First timezone is the local one
                const isSelected = tz === timezone;
                const isIndiaTimezone = tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
                return (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => handleTimezoneClick(tz)}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-100/60 hover:text-blue-900 flex items-center justify-between transition-all duration-150 ${
                      isSelected ? 'bg-blue-200/70 text-blue-900 font-medium border-l-4 border-blue-600' : 'text-gray-800'
                    }`}
                  >
                    <span>
                      {formatTzLabel(tz)}
                      {isLocal && (
                        <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded font-medium">
                          🌍 Your Local Timezone
                        </span>
                      )}
                      {isIndiaTimezone && !isLocal && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                          🇮🇳 India
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <div className="flex items-center">
                        <span className="mr-2 text-blue-600 font-medium text-sm">Selected</span>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="text-blue-500">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        
        <button 
          onClick={onSubmitJobClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white btn-text rounded-lg shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Test A Job
        </button>

        {/* User Authentication Section */}
        <div className="relative">
          <button
            ref={userButtonRef}
            onClick={() => setShowUserMenu(prev => !prev)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {user.username ? user.username.charAt(0).toUpperCase() : 'U'}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-700">{user.username}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showUserMenu && (
            <div
              ref={userMenuRef}
              className="absolute top-full right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
            >
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">{user.username}</p>
                {user.groups && (
                  <p className="text-xs text-gray-500">
                    Groups: {Array.isArray(user.groups) ? user.groups.join(', ') : user.groups}
                  </p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;