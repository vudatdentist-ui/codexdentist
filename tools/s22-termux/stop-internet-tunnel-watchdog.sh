#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
WATCH_PID_FILE="$TERMUX_HOME/codexmed-tunnel-watchdog.pid"

if [ ! -f "$WATCH_PID_FILE" ]; then
  echo "Cloudflare tunnel watchdog is not running."
  exit 0
fi

PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "Stopped Cloudflare tunnel watchdog PID $PID."
else
  echo "Cloudflare tunnel watchdog PID was stale."
fi

rm -f "$WATCH_PID_FILE"
