#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 or higher is required.'
  exit 1
fi
(sleep 2; open 'http://127.0.0.1:4786/phone') &
node server/index.js
