// utils/timezone.js
// Utility for formatting dates with timezone abbreviations

export function formatDateWithTZAbbr(dateInput, selectedTimezone = null) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  
  // Use selected timezone or fall back to browser timezone
  const timeZone = selectedTimezone || localStorage.getItem('router_ui_tz') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  // Debug: Log timezone being used
  if (selectedTimezone) {
    console.log('🕒 formatDateWithTZAbbr: Using selected timezone:', selectedTimezone);
  }
  
  // Get timezone abbreviation using existing utility from api.js
  const getTimezoneAbbr = (tz, date = new Date()) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short'
      });
      
      const parts = formatter.formatToParts(date);
      const timeZonePart = parts.find(part => part.type === 'timeZoneName');
      
      if (timeZonePart && timeZonePart.value) {
        const abbreviation = timeZonePart.value;
        
        // Map some common timezone identifiers to more recognizable abbreviations
        const commonMappings = {
          'Asia/Kolkata': 'IST',
          'Asia/Singapore': 'SGT', 
          'Asia/Tokyo': 'JST',
          'Europe/London': 'GMT', // Simplified for now
          'America/New_York': 'EST', // Simplified for now
          'America/Los_Angeles': 'PST', // Simplified for now
          'Europe/Berlin': 'CET', // Simplified for now
          'Australia/Sydney': 'AEST' // Simplified for now
        };
        
        return commonMappings[tz] || abbreviation;
      }
      
      return 'UTC';
    } catch (error) {
      return 'UTC';
    }
  };
  
  const abbr = getTimezoneAbbr(timeZone, date);
  
  // Format the date in the selected timezone
  const dateFormatted = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timeZone
  }).format(date);
  
  return `${dateFormatted} ${abbr}`;
}
