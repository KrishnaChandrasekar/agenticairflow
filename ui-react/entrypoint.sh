#!/bin/sh

# Inject runtime configuration into the React app
cat > /usr/share/nginx/html/config.js << EOF
// Runtime configuration injected at container start
window.API_BASE = "/api";
window.ROUTER_TOKEN = "${ROUTER_TOKEN}";
EOF

# Start nginx
nginx -g 'daemon off;'