#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
WATCH_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel-watchdog.pid"

pid_matches_watchdog() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "watch-named-tunnel.sh"
}

if [ ! -f "$WATCH_PID_FILE" ]; then
  echo "Named Cloudflare tunnel watchdog is not running."
  exit 0
fi

PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
if pid_matches_watchdog "$PID"; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "Stopped named Cloudflare tunnel watchdog PID $PID."
else
  echo "Named Cloudflare tunnel watchdog PID was stale."
fi

rm -f "$WATCH_PID_FILE"
