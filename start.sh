#!/usr/bin/env bash
# Start on Linux, WSL and macOS.
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1

PORT="${PINMAP_PORT:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is missing. On Debian/Ubuntu:  sudo apt install nodejs"
  echo "  On macOS with Homebrew:                brew install node"
  echo ""
  exit 1
fi

# Mock mode for trying it out without network:  ./start.sh --mock
exec node server.js --port "$PORT" "$@"
