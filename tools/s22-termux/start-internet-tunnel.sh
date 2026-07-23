#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
TUNNEL_LOG="$TERMUX_HOME/codexmed-tunnel.log"
TUNNEL_PID_FILE="$TERMUX_HOME/codexmed-tunnel.pid"
PUBLIC_URL_FILE="$TERMUX_HOME/codexmed-public-url.txt"

termux-wake-lock >/dev/null 2>&1 || true

if [ -f "$TUNNEL_PID_FILE" ]; then
  OLD_PID="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Cloudflare tunnel already running with PID $OLD_PID."
    cat "$PUBLIC_URL_FILE" 2>/dev/null || true
    exit 0
  fi
fi

: > "$TUNNEL_LOG"
rm -f "$PUBLIC_URL_FILE"

cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000 > "$TUNNEL_LOG" 2>&1 &
echo $! > "$TUNNEL_PID_FILE"

for _ in $(seq 1 40); do
  PUBLIC_URL="$(grep -Eo 'https://[-a-zA-Z0-9.]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1 || true)"
  if [ -n "$PUBLIC_URL" ]; then
    echo "$PUBLIC_URL" > "$PUBLIC_URL_FILE"
    echo "$PUBLIC_URL"
    exit 0
  fi
  sleep 1
done

echo "Tunnel started, but public URL was not detected yet. Check $TUNNEL_LOG." >&2
exit 1
