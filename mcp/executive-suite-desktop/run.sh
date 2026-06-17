#!/usr/bin/env bash
# Launch the Executive Suite desktop MCP server (stdio).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [[ ! -d node_modules/@modelcontextprotocol ]]; then
  npm install --omit=dev --no-fund --no-audit >/dev/null 2>&1
fi
exec node server.mjs