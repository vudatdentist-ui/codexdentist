#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
WATCHDOG_PID_FILE="$TERMUX_HOME/codexmed-watchdog.pid"
WATCHDOG_STDOUT="$TERMUX_HOME/codexmed-watchdog.out"

termux-wake-lock >/dev/null 2>&1 || true

pid_matches_watchdog() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "watch-codexmed.sh"
}

if [ -f "$WATCHDOG_PID_FILE" ]; then
  OLD_PID="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if pid_matches_watchdog "$OLD_PID"; then
    echo "CodexMed OS watchdog already running with PID $OLD_PID."
    exit 0
  fi
  rm -f "$WATCHDOG_PID_FILE"
fi

cd "$APP_DIR"
nohup bash tools/s22-termux/watch-codexmed.sh > "$WATCHDOG_STDOUT" 2>&1 &
echo $! > "$WATCHDOG_PID_FILE"
echo "CodexMed OS watchdog started with PID $(cat "$WATCHDOG_PID_FILE")."
