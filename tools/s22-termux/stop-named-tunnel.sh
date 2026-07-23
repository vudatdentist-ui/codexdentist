#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
TUNNEL_PID_FILE="$TERMUX_HOME/codexmed-named-tunnel.pid"

if [ ! -f "$TUNNEL_PID_FILE" ]; then
  echo "Named Cloudflare tunnel is not running."
  exit 0
fi

PID="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "Stopped named Cloudflare tunnel PID $PID."
else
  echo "Named Cloudflare tunnel PID was stale."
fi

rm -f "$TUNNEL_PID_FILE"
