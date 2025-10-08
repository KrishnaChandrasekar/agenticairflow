import React from 'react';

const FlaskIcon = ({ className = "w-4 h-4" }) => {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.5 2v5.5L6 12.5c-.5.9-.5 2 0 2.9l.5.9c.3.5.8.7 1.3.7h8.4c.5 0 1-.2 1.3-.7l.5-.9c.5-.9.5-2 0-2.9L14.5 7.5V2h-5z" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"/>
      <path d="M12 2v5.5" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round"/>
      <circle cx="10" cy="14" r="1" fill="currentColor" opacity="0.6"/>
      <circle cx="13.5" cy="13" r="0.5" fill="currentColor" opacity="0.4"/>
      <circle cx="11" cy="16" r="0.5" fill="currentColor" opacity="0.5"/>
    </svg>
  );
};

export default FlaskIcon;