const detectBrowserTZ = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('🔍 Raw detected timezone:', tz);
    if (!tz) return null;
    
    const alias = {
      'Asia/Kolkata': 'Asia/Kolkata',
      'Asia/Calcutta': 'Asia/Kolkata'
    };
    
    const result = alias[tz] || tz;
    console.log('🔄 After alias mapping:', result);
    return result;
  } catch(e) { 
    console.error('❌ Detection failed:', e);
    return null; 
  }
};

console.log('=== 🇮🇳 India Timezone Detection Test ===');
console.log('📍 Detected timezone:', detectBrowserTZ());
console.log('🕐 Current time in India:', new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}));
console.log('🌍 Current time in system timezone:', new Date().toLocaleString());

// Test localStorage simulation
const testStorage = {};
const mockLocalStorage = {
  getItem: (key) => testStorage[key] || null,
  setItem: (key, value) => testStorage[key] = value,
  removeItem: (key) => delete testStorage[key]
};

console.log('\n=== 🧪 Timezone Hook Simulation ===');

// Simulate the timezone hook logic
const simulateTimezoneHook = () => {
  // First check localStorage
  const stored = mockLocalStorage.getItem("router_ui_tz");
  console.log('💾 Stored timezone:', stored);
  
  // Detect local timezone
  const detectedTZ = detectBrowserTZ();
  
  if (detectedTZ) {
    // If no stored value OR stored value differs from detected, use detected
    if (!stored || stored !== detectedTZ) {
      console.log(`🔄 Setting timezone to detected local: ${detectedTZ}`);
      mockLocalStorage.setItem("router_ui_tz", detectedTZ);
      return detectedTZ;
    }
    // If stored matches detected, use stored
    console.log(`✅ Using stored timezone: ${stored} (matches local)`);
    return stored;
  }
  
  // Fallback
  if (stored) {
    console.log(`📂 Using stored timezone: ${stored}`);
    return stored;
  }
  
  const fallback = "UTC";
  console.log(`🔄 Fallback to UTC`);
  mockLocalStorage.setItem("router_ui_tz", fallback);
  return fallback;
};

const result = simulateTimezoneHook();
console.log('🎯 Final timezone result:', result);