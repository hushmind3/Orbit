#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 or higher is required.'
  exit 1
fi
export ORBIT_OPEN_BROWSER=phone
node server/index.js
