#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
WATCH_PID_FILE="$TERMUX_HOME/codexmed-tunnel-watchdog.pid"
WATCH_STDOUT="$TERMUX_HOME/codexmed-tunnel-watchdog.out"

termux-wake-lock >/dev/null 2>&1 || true

if [ -f "$WATCH_PID_FILE" ]; then
  OLD_PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Cloudflare tunnel watchdog already running with PID $OLD_PID."
    cat "$TERMUX_HOME/codexmed-public-url.txt" 2>/dev/null || true
    exit 0
  fi
fi

cd "$APP_DIR"
nohup bash tools/s22-termux/watch-internet-tunnel.sh > "$WATCH_STDOUT" 2>&1 &
echo $! > "$WATCH_PID_FILE"
echo "Cloudflare tunnel watchdog started with PID $(cat "$WATCH_PID_FILE")."
sleep 2
cat "$TERMUX_HOME/codexmed-public-url.txt" 2>/dev/null || true
