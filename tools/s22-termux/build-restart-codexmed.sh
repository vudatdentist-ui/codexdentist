#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
DB_DIR="$TERMUX_PREFIX/var/lib/postgresql"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public"
LOG_FILE="$TERMUX_HOME/codexmed-server.log"
PID_FILE="$TERMUX_HOME/codexmed-server.pid"

source "$APP_DIR/tools/s22-termux/postgres-runtime-env.sh"

codexmed_server_pids() {
  local pid=""
  for pid in $(pgrep -f next-server 2>/dev/null || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null || true)" = "$APP_DIR" ]; then
      echo "$pid"
    fi
  done
}

termux-wake-lock >/dev/null 2>&1 || true

if ! psql "postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite" -Atc "select 1;" >/dev/null 2>&1; then
  clean_android_shmem_keys
  postgres_runtime_env pg_ctl -D "$DB_DIR" -l "$TERMUX_HOME/postgres.log" start
fi

cd "$APP_DIR"
node tools/s22-termux/prepare-phone-package.mjs
DATABASE_URL="$DB_URL" npm install --package-lock=false --include=dev
DATABASE_URL="$DB_URL" node node_modules/prisma/build/index.js generate
DATABASE_URL="$DB_URL" node tools/s22-termux/apply-raw-migrations.mjs
DATABASE_URL="$DB_URL" CODEXMED_PHONE_BUILD=true node node_modules/next/dist/bin/next build --webpack

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    kill "$OLD_PID" || true
  fi
fi

for OLD_PID in $(codexmed_server_pids); do
  kill "$OLD_PID" >/dev/null 2>&1 || true
done
sleep 2

DATABASE_URL="$DB_URL" HOSTNAME=0.0.0.0 PORT=3000 node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000 >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 5
SERVER_PID="$(codexmed_server_pids | tail -n 1)"
if [ -n "$SERVER_PID" ]; then
  echo "$SERVER_PID" >"$PID_FILE"
fi

bash tools/s22-termux/keep-codexmed-alive.sh >/dev/null 2>&1 || true
bash tools/s22-termux/keep-9router-alive.sh >/dev/null 2>&1 || true
bash tools/s22-termux/keep-named-tunnel-alive.sh >/dev/null 2>&1 || true

echo "CodexMed OS built and restarted with PID $(cat "$PID_FILE")."
