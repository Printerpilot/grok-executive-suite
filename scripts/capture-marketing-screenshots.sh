#!/usr/bin/env bash
# Capture privacy-safe marketing screenshots for X / GitHub.
# Uses Electron capturePage (no macOS screen-recording permission dialog).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/screenshots"

kill_app() {
  pkill -f "electron.*grok-executive-suite" 2>/dev/null || true
  pkill -f "electron.*grok-cowork-app" 2>/dev/null || true
  pkill -f "Grok Executive Suite" 2>/dev/null || true
  sleep 1
}

on_exit() {
  kill_app
  node "$ROOT/scripts/restore-marketing-state.js" 2>/dev/null || true
}
trap on_exit EXIT

mkdir -p "$OUT"

echo "==> Preparing sanitized marketing state..."
node "$ROOT/scripts/prepare-marketing-state.js"

capture_view() {
  local view="$1"
  local outfile="$2"

  echo "==> Capturing: $view -> $(basename "$outfile")"
  kill_app

  cd "$ROOT"
  GROK_MARKETING_VIEW="$view" GROK_MARKETING_CAPTURE="$outfile" npm start 2>&1 | grep -E '\[marketing\]|error' || true

  if [[ ! -f "$outfile" ]]; then
    echo "WARN: Capture failed for $view"
    return 1
  fi
  echo "    saved $(wc -c < "$outfile" | tr -d ' ') bytes"
}

capture_view "main" "$OUT/01-full-app-fusion-task.png"
capture_view "scheduled" "$OUT/02-scheduled-task-details.png"
capture_view "sidebar" "$OUT/03-sidebar-and-panels.png"

echo ""
echo "Screenshots saved to $OUT"
ls -la "$OUT"/*.png 2>/dev/null || true