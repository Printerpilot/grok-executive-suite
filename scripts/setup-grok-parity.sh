#!/usr/bin/env bash
# Install Grok Build MCP + config for full Grok Executive Suite feature parity.
# Run after installing Grok Build CLI and Grok Executive Suite.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GROK_BIN="${HOME}/.grok/bin/grok"
TEMP_CLONE=""

cleanup() {
  [[ -n "$TEMP_CLONE" && -d "$TEMP_CLONE" ]] && rm -rf "$TEMP_CLONE"
}
trap cleanup EXIT

if [[ ! -f "$ROOT/lib/desktop-control.js" ]]; then
  echo "→ Repo files not found locally; shallow-cloning for setup..."
  TEMP_CLONE="$(mktemp -d)"
  git clone --depth 1 https://github.com/Printerpilot/grok-executive-suite.git "$TEMP_CLONE"
  ROOT="$TEMP_CLONE"
fi
INSTALL_DIR="${HOME}/.grok-cowork/mcp/executive-suite-desktop"
USER_CONFIG="${HOME}/.grok/config.toml"

echo "Grok Executive Suite — feature parity setup"
echo "============================================"
echo ""

# --- Prerequisites ---
if [[ ! -x "$GROK_BIN" ]]; then
  echo "✗ Grok Build CLI not found at $GROK_BIN"
  echo "  Install: curl -fsSL https://x.ai/cli/install.sh | bash"
  exit 1
fi
echo "✓ Grok Build CLI: $($GROK_BIN --version 2>&1 | head -1)"

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "⚠ Apple Silicon recommended (found $(uname -m))"
fi

# --- Install desktop MCP server to stable user path (works for DMG-only users) ---
echo ""
echo "→ Installing desktop control MCP to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/lib"
cp "$ROOT/mcp/executive-suite-desktop/server.mjs" "$INSTALL_DIR/"
cp "$ROOT/mcp/executive-suite-desktop/package.json" "$INSTALL_DIR/"
cp "$ROOT/mcp/executive-suite-desktop/run.sh" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/run.sh"
cp "$ROOT/lib/desktop-control.js" "$INSTALL_DIR/lib/desktop-control.cjs"
cp "$ROOT/lib/mouse-control.jxa" "$INSTALL_DIR/lib/"
cp "$ROOT/lib/cursor-position.jxa" "$INSTALL_DIR/lib/"

(cd "$INSTALL_DIR" && npm install --omit=dev --no-fund --no-audit)
echo "✓ MCP server installed"

# --- Register user-scoped MCP (available in all projects) ---
echo ""
echo "→ Registering executive-suite-desktop MCP with Grok Build"
"$GROK_BIN" mcp remove executive-suite-desktop 2>/dev/null || true
"$GROK_BIN" mcp add executive-suite-desktop -- bash "$INSTALL_DIR/run.sh"
echo "✓ MCP registered (user scope)"

# --- Ensure permission_mode in user config (optional CLI-side parity) ---
echo ""
mkdir -p "$(dirname "$USER_CONFIG")"
if [[ -f "$USER_CONFIG" ]] && grep -q 'permission_mode' "$USER_CONFIG" 2>/dev/null; then
  echo "✓ Grok permission_mode already configured in $USER_CONFIG"
elif [[ -f "$USER_CONFIG" ]] && grep -q '^\[ui\]' "$USER_CONFIG" 2>/dev/null; then
  # Insert permission_mode immediately after [ui] header
  awk '/^\[ui\]/ { print; print "permission_mode = \"always-approve\""; next } { print }' \
    "$USER_CONFIG" > "${USER_CONFIG}.tmp" && mv "${USER_CONFIG}.tmp" "$USER_CONFIG"
  echo "✓ Added permission_mode to existing [ui] in $USER_CONFIG"
else
  {
    echo ""
    echo "[ui]"
    echo 'permission_mode = "always-approve"'
  } >> "$USER_CONFIG"
  echo "✓ Created [ui] permission_mode in $USER_CONFIG"
fi

# --- macOS permissions reminder ---
echo ""
echo "macOS permissions (required for desktop control + capture):"
echo "  System Settings → Privacy & Security →"
echo "    • Accessibility — enable for Grok Executive Suite AND Terminal (or iTerm)"
echo "    • Screen Recording — enable for Grok Executive Suite (desktop screenshot attach)"
echo ""

# --- Verify MCP ---
echo "→ Verifying MCP connectivity"
if (cd /tmp && "$GROK_BIN" mcp doctor executive-suite-desktop >/dev/null 2>&1); then
  echo "✓ MCP doctor passed (7 tools)"
else
  echo "⚠ MCP doctor reported issues — re-run: npm run setup:parity"
  exit 1
fi

# --- Desktop control smoke test ---
echo ""
echo "→ Running desktop control smoke test"
if node "$ROOT/scripts/test-desktop-control.js" 2>&1; then
  echo "✓ Desktop control smoke test passed"
else
  echo "⚠ Desktop control test failed — grant Accessibility permission and re-run:"
  echo "    npm run test:desktop"
fi

echo ""
echo "Parity setup complete."
echo ""
echo "Built-in Grok Build tools (no extra setup): Shell, filesystem, web search, subagents, skills."
echo "Desktop control: executive-suite-desktop MCP (registered above)."
echo "In the app: toggle 'Act without asking' ON for --always-approve on every task."
echo ""
echo "Verify everything: npm run verify:full"