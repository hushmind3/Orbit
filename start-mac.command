#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js 22+ is required'; exit 1; }
[ -d node_modules/qrcode ] || npm install
[ -f dist/index.html ] || npm run build
export ORBIT_OPEN_BROWSER=0
exec node server/index.js
