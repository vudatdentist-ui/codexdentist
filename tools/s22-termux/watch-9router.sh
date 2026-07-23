#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"
export HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
export NPM_CONFIG_PREFIX="$TERMUX_PREFIX"

PORT="${NINE_ROUTER_PORT:-20128}"
APP_DIR="$HOME/codexmed-os"
WATCH_PID_FILE="$HOME/9router-watchdog.pid"
WATCH_LOG="$HOME/9router-watchdog.log"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-30}"

echo $$ > "$WATCH_PID_FILE"
termux-wake-lock >/dev/null 2>&1 || true

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$WATCH_LOG"
}

router_healthy() {
  node -e "
const timeout = setTimeout(() => process.exit(2), 8000);
fetch('http://127.0.0.1:${PORT}/v1/models', { headers: { authorization: 'Bearer probe' } })
  .then((res) => {
    clearTimeout(timeout);
    process.exit(res.status < 500 ? 0 : 1);
  })
  .catch(() => {
    clearTimeout(timeout);
    process.exit(1);
  });
" >/dev/null 2>&1
}

log "9router watchdog started."

while true; do
  if ! router_healthy; then
    log "9router is down; starting it."
    bash "$APP_DIR/tools/s22-termux/start-9router.sh" >> "$WATCH_LOG" 2>&1 || true
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
done
