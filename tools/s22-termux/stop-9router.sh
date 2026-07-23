#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
PID_FILE="$HOME/9router.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "9router is not running."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "Stopped 9router PID $PID."
else
  echo "9router PID was stale."
fi

rm -f "$PID_FILE"
