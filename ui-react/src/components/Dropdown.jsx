import React, { useState, useRef, useEffect } from 'react';

/**
 * Generic Dropdown component
 * Props:
 * - options: Array<{ value: string, label: string }>
 * - value: string (selected value)
 * - onChange: function(value)
 * - placeholder: string (optional)
 * - className: string (optional)
 * - buttonClassName: string (optional)
 * - optionClassName: string (optional)
 * - width: string (optional, e.g. '180px')
 */
const Dropdown = ({
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  buttonClassName = '',
  optionClassName = '',
  width = '180px',
}) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Keyboard navigation (optional, can be extended)

  const selectedLabel = options.find(opt => opt.value === value)?.label || placeholder;

  return (
    <div ref={dropdownRef} className={`relative min-w-[${width}]`} style={{ width }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 pr-10 bg-white border border-blue-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer w-full text-left ${buttonClassName}`}
        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        <span className="truncate block w-full">{selectedLabel}</span>
      </button>
      <svg className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      {open && (
        <div className={`absolute top-full left-0 mt-2 w-full bg-white border border-blue-200 rounded-lg shadow-lg z-50 overflow-hidden ${className}`}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm font-medium transition-all duration-150 ${
                value === option.value
                  ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                  : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
              } ${optionClassName}`}
            >
              {option.label}
              {value === option.value && (
                <span className="ml-auto flex items-center">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
