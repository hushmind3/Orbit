#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo 'Node.js 22+ is required'; exit 1; fi
[ -d node_modules/qrcode ] || npm install || exit 1
ORBIT_OPEN_BROWSER=1 node server/index.js
