#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"
export HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
export NPM_CONFIG_PREFIX="$TERMUX_PREFIX"

PORT="${NINE_ROUTER_PORT:-20128}"
HOST="${NINE_ROUTER_HOST:-127.0.0.1}"
PID_FILE="$HOME/9router.pid"
LOG_FILE="$HOME/9router.log"

termux-wake-lock >/dev/null 2>&1 || true

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "9router already running with PID $OLD_PID."
    exit 0
  fi
fi

: > "$LOG_FILE"
node "$TERMUX_PREFIX/lib/node_modules/9router/cli.js" --host "$HOST" --port "$PORT" --no-browser --skip-update > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "9router started with PID $(cat "$PID_FILE")."
echo "Endpoint: http://$HOST:$PORT/v1"
echo "Log: $LOG_FILE"
