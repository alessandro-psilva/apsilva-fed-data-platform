#!/bin/sh
set -eu

API_BASE_URL="${FRONTEND_API_BASE_URL:?FRONTEND_API_BASE_URL is required}"

cat > /usr/share/nginx/html/assets/config.js <<EOF
window.APP_CONFIG = {
  apiBaseUrl: "${API_BASE_URL}",
};
EOF

echo "[frontend] Generated assets/config.js with FRONTEND_API_BASE_URL=${API_BASE_URL}"
