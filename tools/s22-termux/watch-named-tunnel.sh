#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
WATCH_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel-watchdog.pid"
TUNNEL_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel.pid"
WATCH_LOG="$TERMUX_HOME/codexmed-named-tunnel-watchdog.log"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-30}"

echo $$ > "$WATCH_PID_FILE"
termux-wake-lock >/dev/null 2>&1 || true

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$WATCH_LOG"
}

pid_cmdline_contains() {
  local pid="${1:-}"
  local pattern="${2:-}"
  [ -n "$pid" ] && [ -n "$pattern" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "$pattern"
}

tunnel_alive() {
  local pid=""
  pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1 && pid_cmdline_contains "$pid" "cloudflared"
}

log "Named Cloudflare tunnel watchdog started."

while true; do
  if ! tunnel_alive; then
    log "Named Cloudflare tunnel is down; starting it."
    cd "$APP_DIR"
    bash tools/s22-termux/start-named-tunnel.sh >> "$WATCH_LOG" 2>&1 || true
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
done
