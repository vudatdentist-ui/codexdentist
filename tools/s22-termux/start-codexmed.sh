#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
DB_DIR="$TERMUX_PREFIX/var/lib/postgresql"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public"

source "$APP_DIR/tools/s22-termux/postgres-runtime-env.sh"

termux-wake-lock || true

if ! psql "postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite" -Atc "select 1;" >/dev/null 2>&1; then
  clean_android_shmem_keys
  postgres_runtime_env pg_ctl -D "$DB_DIR" -l "$TERMUX_HOME/postgres.log" start
fi

cd "$APP_DIR"
DATABASE_URL="$DB_URL" HOSTNAME=0.0.0.0 PORT=3000 node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000
