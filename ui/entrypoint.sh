#!/bin/sh
#set -e
#cat >/usr/share/nginx/html/config.js <<EOF
#window.ROUTER_BASE_URL = "${ROUTER_BASE_URL:-http://localhost:8000}";
#window.ROUTER_TOKEN = "${ROUTER_TOKEN:-router-secret}";
#EOF

set -e

: "${ROUTER_INTERNAL_URL:=http://router:8000}"
: "${ROUTER_TOKEN:=router-secret}"

# 0) Remove the stock server so only our server block is active
rm -f /etc/nginx/conf.d/default.conf || true

# 1) Runtime JS config for the SPA (UI calls same-origin /api/*)
cat >/usr/share/nginx/html/config.js <<'JS'
window.API_BASE = "/api";
window.ROUTER_BASE_URL = "";
window.ROUTER_TOKEN = "";
JS

# 2) Nginx template: proxy /api/* to Router and inject Bearer token
cat >/tmp/proxy.tmpl <<'NGX'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
access_log /var/log/nginx/access.log combined;

server {
  listen 80 default_server;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # --- API proxy (must precede /)
  location ^~ /api/ {
    proxy_http_version 1.1;

    # Inject token so browser doesn't need to send it
    proxy_set_header Authorization "Bearer ${ROUTER_TOKEN}";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # Strip /api prefix and forward to Router
    proxy_pass ${ROUTER_INTERNAL_URL}/;

    # WS friendly
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }

  # Static SPA fallback
  location = / { try_files /index.html =404; }
  location /  { try_files $uri $uri/ /index.html; }
}
NGX

# 3) Expand only our envs (leaves $http_* intact)
envsubst '${ROUTER_INTERNAL_URL} ${ROUTER_TOKEN}' </tmp/proxy.tmpl >/etc/nginx/conf.d/10-proxy.conf
