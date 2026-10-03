#!/data/data/com.termux/files/usr/bin/bash
# Stops the server running in the background.

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HIER" || exit 1

if [ -f .server.pid ]; then
  PID="$(cat .server.pid)"
  if kill "$PID" 2>/dev/null; then
    echo "  Stopped (PID $PID)."
  else
    echo "  Was no longer running."
  fi
  rm -f .server.pid
else
  pkill -f "node server.js" && echo "  Stopped." || echo "  Was not running."
fi

command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null
exit 0
