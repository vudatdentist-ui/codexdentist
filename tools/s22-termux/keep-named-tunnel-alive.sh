#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
WATCH_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel-watchdog.pid"
WATCH_STDOUT="$TERMUX_HOME/codexmed-named-tunnel-watchdog.out"

termux-wake-lock >/dev/null 2>&1 || true

pid_matches_watchdog() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "watch-named-tunnel.sh"
}

if [ -f "$WATCH_PID_FILE" ]; then
  OLD_PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if pid_matches_watchdog "$OLD_PID"; then
    echo "Named Cloudflare tunnel watchdog already running with PID $OLD_PID."
    exit 0
  fi
  rm -f "$WATCH_PID_FILE"
fi

cd "$APP_DIR"
nohup bash tools/s22-termux/watch-named-tunnel.sh > "$WATCH_STDOUT" 2>&1 &
echo $! > "$WATCH_PID_FILE"
echo "Named Cloudflare tunnel watchdog started with PID $(cat "$WATCH_PID_FILE")."
