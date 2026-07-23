#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public"

cd "$APP_DIR"
DATABASE_URL="$DB_URL" node tools/s22-termux/apply-raw-migrations.mjs
