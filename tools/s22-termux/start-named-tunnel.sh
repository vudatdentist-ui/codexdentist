#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
TOKEN_FILE="$TERMUX_HOME/codexmed-cloudflare-tunnel-token"
TUNNEL_LOG="$TERMUX_HOME/codexmed-named-tunnel.log"
TUNNEL_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel.pid"

termux-wake-lock >/dev/null 2>&1 || true

pid_matches_tunnel() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "cloudflared"
}

if [ ! -s "$TOKEN_FILE" ]; then
  cat <<EOF >&2
Missing Cloudflare tunnel token file:
  $TOKEN_FILE

Create the tunnel in Cloudflare Zero Trust, then save the connector token here:
  nano $TOKEN_FILE
  chmod 600 $TOKEN_FILE
EOF
  exit 1
fi

if [ -f "$TUNNEL_PID_FILE" ]; then
  OLD_PID="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
  if pid_matches_tunnel "$OLD_PID"; then
    echo "Named Cloudflare tunnel already running with PID $OLD_PID."
    exit 0
  fi
  rm -f "$TUNNEL_PID_FILE"
fi

TOKEN="$(tr -d '\r\n ' < "$TOKEN_FILE")"
: > "$TUNNEL_LOG"

cloudflared tunnel --no-autoupdate run --token "$TOKEN" > "$TUNNEL_LOG" 2>&1 &
echo $! > "$TUNNEL_PID_FILE"
echo "Named Cloudflare tunnel started with PID $(cat "$TUNNEL_PID_FILE")."
echo "Log: $TUNNEL_LOG"
