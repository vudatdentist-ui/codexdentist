#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
APP_DIR="$TERMUX_HOME/codexmed-os"
DB_DIR="$TERMUX_PREFIX/var/lib/postgresql"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public"
PSQL_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite"
PORT="${CODEXMED_PORT:-3000}"
BIND_HOST="${CODEXMED_BIND_HOST:-0.0.0.0}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-30}"
SERVER_LOG="$TERMUX_HOME/codexmed-server.log"
WATCHDOG_LOG="$TERMUX_HOME/codexmed-watchdog.log"
SERVER_PID_FILE="$TERMUX_HOME/codexmed-server.pid"
WATCHDOG_PID_FILE="$TERMUX_HOME/codexmed-watchdog.pid"

source "$APP_DIR/tools/s22-termux/postgres-runtime-env.sh"

mkdir -p "$TERMUX_HOME"
echo $$ > "$WATCHDOG_PID_FILE"
termux-wake-lock >/dev/null 2>&1 || true

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$WATCHDOG_LOG"
}

pid_is_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

pid_cmdline_contains() {
  local pid="${1:-}"
  local pattern="${2:-}"
  [ -n "$pid" ] && [ -n "$pattern" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "$pattern"
}

codexmed_server_pids() {
  local pid=""
  for pid in $(pgrep -f next-server 2>/dev/null || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null || true)" = "$APP_DIR" ]; then
      echo "$pid"
    fi
  done
}

postgres_is_ready() {
  psql "$PSQL_URL" -Atc "select 1;" >/dev/null 2>&1
}

start_postgres() {
  if postgres_is_ready; then
    return
  fi

  log "PostgreSQL is down; starting it."
  clean_android_shmem_keys
  postgres_runtime_env pg_ctl -D "$DB_DIR" -l "$TERMUX_HOME/postgres.log" start >/dev/null 2>&1 || true
  sleep 3

  if ! postgres_is_ready; then
    log "PostgreSQL still not reachable after restart attempt."
  fi
}

server_is_ready() {
  node -e "
const url = 'http://127.0.0.1:${PORT}/api/health';
const timeout = setTimeout(() => process.exit(2), 8000);
fetch(url)
  .then(async (res) => {
    clearTimeout(timeout);
    if (!res.ok) process.exit(1);
    const body = await res.json().catch(() => ({}));
    process.exit(body.status === 'ok' && body.database === 'ok' ? 0 : 1);
  })
  .catch(() => {
    clearTimeout(timeout);
    process.exit(1);
  });
" >/dev/null 2>&1
}

start_server() {
  if server_is_ready; then
    return
  fi

  local old_pid=""
  old_pid="$(cat "$SERVER_PID_FILE" 2>/dev/null || true)"
  if pid_is_alive "$old_pid"; then
    if pid_cmdline_contains "$old_pid" "next"; then
      log "Next.js health check failed; stopping stale PID $old_pid."
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 2
    else
      log "Ignoring stale server PID file; PID $old_pid is not Next.js."
      rm -f "$SERVER_PID_FILE"
    fi
  fi
  for old_pid in $(codexmed_server_pids); do
    log "Stopping CodexMed Next.js server PID $old_pid."
    kill "$old_pid" >/dev/null 2>&1 || true
  done
  sleep 2

  cd "$APP_DIR"
  log "Starting CodexMed OS on ${BIND_HOST}:${PORT}."
  DATABASE_URL="$DB_URL" HOSTNAME="$BIND_HOST" PORT="$PORT" \
    node node_modules/next/dist/bin/next start -H "$BIND_HOST" -p "$PORT" \
    >> "$SERVER_LOG" 2>&1 &
  echo $! > "$SERVER_PID_FILE"
  sleep 5

  if server_is_ready; then
    local server_pid=""
    server_pid="$(codexmed_server_pids | tail -n 1)"
    if [ -n "$server_pid" ]; then
      echo "$server_pid" > "$SERVER_PID_FILE"
    fi
    log "CodexMed OS is healthy."
  else
    log "CodexMed OS did not become healthy after start attempt."
  fi
}

log "CodexMed OS watchdog started."

while true; do
  start_postgres
  start_server
  sleep "$CHECK_INTERVAL_SECONDS"
done
