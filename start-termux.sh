#!/data/data/com.termux/files/usr/bin/bash
#
# Starts the Ortsammlung on the phone.
#
#   Once:       pkg install nodejs
#   Start:      ./start-termux.sh
#
# If the script is linked into ~/.termux/boot/ (see README), it starts
# by itself when the phone is switched on.

set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HIER" || exit 1

PORT="${PINMAP_PORT:-8080}"

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is missing. Install it once:"
  echo ""
  echo "      pkg update && pkg install nodejs"
  echo ""
  exit 1
fi

# ---------------------------------------------------------------------------
# So that Android does not kill the server while asleep
# ---------------------------------------------------------------------------

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  trap 'termux-wake-unlock 2>/dev/null || true' EXIT
fi

# ---------------------------------------------------------------------------
# Is one already running?
# ---------------------------------------------------------------------------

if [ -f .server.pid ] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
  echo ""
  echo "  Already running (PID $(cat .server.pid))."
  echo "  In browser:  http://127.0.0.1:$PORT/"
  echo "  Stop:        ./stop-termux.sh"
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Go
# ---------------------------------------------------------------------------

if [ "${1:-}" = "--hintergrund" ]; then
  mkdir -p data
  nohup node server.js --port "$PORT" >> data/server.log 2>&1 &
  echo $! > .server.pid
  sleep 1
  echo ""
  echo "  Running in the background (PID $(cat .server.pid))."
  echo "  In browser:  http://127.0.0.1:$PORT/"
  echo "  Log:         data/server.log"
  echo "  Stop:        ./stop-termux.sh"
  echo ""
else
  exec node server.js --port "$PORT"
fi
