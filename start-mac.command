#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo 'Node.js 22+ is required'; exit 1; fi
[ -d node_modules/react ] || npm install
[ -f dist/index.html ] || npm run build
ORBIT_OPEN_BROWSER=1 node server/index.js
