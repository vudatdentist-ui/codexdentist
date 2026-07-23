#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
WATCHDOG_PID_FILE="$TERMUX_HOME/codexmed-watchdog.pid"

pid_matches_watchdog() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "watch-codexmed.sh"
}

if [ ! -f "$WATCHDOG_PID_FILE" ]; then
  echo "CodexMed OS watchdog is not running."
  exit 0
fi

PID="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
if pid_matches_watchdog "$PID"; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "Stopped CodexMed OS watchdog PID $PID."
else
  echo "CodexMed OS watchdog PID was stale."
fi

rm -f "$WATCHDOG_PID_FILE"
