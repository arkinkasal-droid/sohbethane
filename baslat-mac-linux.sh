#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js kurulu degil. https://nodejs.org adresinden kurun."; exit 1; }
[ -d node_modules ] || npm install
node server.js
