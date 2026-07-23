#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"
export HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"

APP_DIR="$HOME/codexmed-os"
WATCH_PID_FILE="$HOME/9router-watchdog.pid"
WATCH_STDOUT="$HOME/9router-watchdog.out"

termux-wake-lock >/dev/null 2>&1 || true

if [ -f "$WATCH_PID_FILE" ]; then
  OLD_PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "9router watchdog already running with PID $OLD_PID."
    exit 0
  fi
fi

cd "$APP_DIR"
nohup bash tools/s22-termux/watch-9router.sh > "$WATCH_STDOUT" 2>&1 &
echo $! > "$WATCH_PID_FILE"
echo "9router watchdog started with PID $(cat "$WATCH_PID_FILE")."
