#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"
export HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
export NPM_CONFIG_PREFIX="$TERMUX_PREFIX"

termux-wake-lock >/dev/null 2>&1 || true

npm install -g 9router@0.4.39 --prefer-online --no-audit --no-fund
node "$TERMUX_PREFIX/lib/node_modules/9router/cli.js" --version
