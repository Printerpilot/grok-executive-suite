#!/usr/bin/env bash
# Verify system prerequisites for Grok Executive Suite.
set -euo pipefail

GROK_BIN="${HOME}/.grok/bin/grok"
OK=0
WARN=0

pass() { echo "✓ $1"; OK=$((OK + 1)); }
fail() { echo "✗ $1"; WARN=$((WARN + 1)); }
info() { echo "  → $1"; }

echo "Grok Executive Suite — setup verification"
echo "=========================================="
echo ""

# macOS
if [[ "$(uname -s)" == "Darwin" ]]; then
  pass "macOS detected ($(sw_vers -productVersion))"
else
  fail "macOS required (found $(uname -s))"
fi

# Apple Silicon
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  pass "Apple Silicon (arm64)"
else
  fail "Apple Silicon required for release builds (found $ARCH)"
  info "Intel Macs: build from source with npm run dist after adjusting arch"
fi

# Grok Build CLI
if [[ -x "$GROK_BIN" ]]; then
  pass "Grok Build CLI found at $GROK_BIN"
  if VERSION_OUT="$("$GROK_BIN" --version 2>&1)"; then
    info "$VERSION_OUT"
  else
    info "Could not read version (run '$GROK_BIN' to sign in)"
  fi
else
  fail "Grok Build CLI not found at $GROK_BIN"
  info "Install: curl -fsSL https://x.ai/cli/install.sh | bash"
  info "Requires SuperGrok or X Premium Plus subscription"
fi

# Node (developers only)
if command -v node >/dev/null 2>&1; then
  pass "Node.js $(node --version) (for building from source)"
else
  info "Node.js not found — only needed for building from source, not DMG install"
fi

echo ""
if [[ $WARN -eq 0 ]]; then
  echo "All checks passed. You're ready to use Grok Executive Suite."
  exit 0
else
  echo "$WARN check(s) failed. Fix the items above before using the app."
  exit 1
fi