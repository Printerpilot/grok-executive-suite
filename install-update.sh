#!/bin/zsh
# Open the latest Grok Executive Suite DMG for drag-to-Applications install.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="0.3.2"
DMG="$ROOT/dist/Grok Executive Suite-${VERSION}-arm64.dmg"

if [[ ! -f "$DMG" ]]; then
  echo "DMG not found: $DMG"
  echo "Build first: cd $ROOT && npm run dist"
  exit 1
fi

echo "Opening $DMG ..."
open "$DMG"
echo ""
echo "In Finder: drag Grok Executive Suite.app to Applications (replace existing)."
echo "Then launch from Applications. Version should read ${VERSION} in the sidebar."
echo ""
echo "Prerequisite: Grok Build CLI must be installed:"
echo "  curl -fsSL https://x.ai/cli/install.sh | bash"