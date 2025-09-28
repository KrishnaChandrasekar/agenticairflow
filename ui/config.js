// ui/config.js
// Runtime configuration injected at container start by entrypoint.sh
// The UI always calls window.API_BASE + "/jobs" etc.
window.API_BASE = "/api";

// Router URL + token are NOT exposed to the browser;
// nginx proxy injects the Authorization header server-side.
