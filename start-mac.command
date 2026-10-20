#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js 22+ is required'; exit 1; }
[ -f node_modules/@tailwindcss/vite/package.json ] || npm install
npm run build
export ORBIT_OPEN_BROWSER=0
exec node server/index.js
