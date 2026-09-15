#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:?release SHA is required}"
APP_DIR="${2:?application root is required}"
ARCHIVE_NAME="${3:?archive name is required}"
DOMAIN="${4:?application domain is required}"

NODE_BIN="/opt/alt/alt-nodejs22/root/usr/bin"
ARCHIVE_PATH="$HOME/$ARCHIVE_NAME"
RELEASES_DIR="$APP_DIR/.codexdentist-releases"
RELEASE_DIR="$RELEASES_DIR/$SHA"
ROLLBACK_DIR="$APP_DIR/.codexdentist-rollback-$SHA"
PROMOTED_MANIFEST="$ROLLBACK_DIR/.promoted-items"
LOCK_PATH="$HOME/.codexdentist-deploy.lock"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Application root does not exist: $APP_DIR" >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Production .env is missing from $APP_DIR; refusing to deploy." >&2
  exit 1
fi
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Release archive is missing: $ARCHIVE_PATH" >&2
  exit 1
fi
if [[ ! -x "$NODE_BIN/node" || ! -x "$NODE_BIN/npm" ]]; then
  echo "Node.js 22 runtime was not found at $NODE_BIN." >&2
  exit 1
fi
if ! command -v cloudlinux-selector >/dev/null 2>&1; then
  echo "cloudlinux-selector is unavailable; refusing an uncontrolled restart." >&2
  exit 1
fi
for tool in pg_dump pg_restore psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is unavailable; refusing a migration without rollback tooling." >&2
    exit 1
  fi
done

exec 9>"$LOCK_PATH"
if ! flock -n 9; then
  echo "Another Codexdentist deployment is already running." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is missing from the production environment." >&2
  exit 1
fi
if [[ -z "${JOB_SECRET:-}" ]]; then
  echo "JOB_SECRET is missing from the production environment." >&2
  exit 1
fi

cutover_started=0
database_backup_created=0
migration_attempted=0
deployment_succeeded=0
preserve_rollback=0

cleanup_staging() {
  rm -rf -- "$RELEASE_DIR" "$ARCHIVE_PATH"
}

start_app() {
  cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null
}

stop_app() {
  cloudlinux-selector stop --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null
}

restore_previous_release() {
  local status=$?
  trap - ERR
  set +e
  local database_restore_failed=0
  local filesystem_restore_failed=0

  echo "Deployment failed; starting rollback." >&2

  if [[ "$database_backup_created" == "1" && "$migration_attempted" == "1" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
    local schema_reset_status=$?
    pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" "$ROLLBACK_DIR/database.dump" >/dev/null
    local restore_status=$?
    if [[ "$schema_reset_status" -ne 0 || "$restore_status" -ne 0 ]]; then
      database_restore_failed=1
      echo "Database rollback failed; application will remain stopped." >&2
    fi
  fi

  if [[ "$cutover_started" == "1" ]]; then
    stop_app || true
    if [[ -f "$PROMOTED_MANIFEST" ]]; then
      while IFS=$'\t' read -r had_old name; do
        [[ -n "$name" ]] || continue
        if [[ "$had_old" == "1" ]]; then
          if [[ -e "$ROLLBACK_DIR/$name" || -L "$ROLLBACK_DIR/$name" ]]; then
            rm -rf -- "$APP_DIR/$name"
            if ! mv -- "$ROLLBACK_DIR/$name" "$APP_DIR/$name"; then
              filesystem_restore_failed=1
            fi
          else
            filesystem_restore_failed=1
          fi
        else
          rm -rf -- "$APP_DIR/$name"
        fi
      done < "$PROMOTED_MANIFEST"
    fi

    # Defensive fallback for any item moved to rollback but not represented in
    # the manifest. Never move the database dump or manifest into the app root.
    if [[ -d "$ROLLBACK_DIR" ]]; then
      while IFS= read -r -d '' item; do
        name="${item##*/}"
        case "$name" in
          .promoted-items|database.dump) continue ;;
        esac
        if [[ ! -e "$APP_DIR/$name" && ! -L "$APP_DIR/$name" ]]; then
          if ! mv -- "$item" "$APP_DIR/$name"; then
            filesystem_restore_failed=1
          fi
        fi
      done < <(find "$ROLLBACK_DIR" -mindepth 1 -maxdepth 1 -print0)
    fi
  fi

  if [[ "$database_restore_failed" == "0" && "$filesystem_restore_failed" == "0" ]]; then
    if [[ "$cutover_started" == "1" ]]; then
      if ! start_app; then
        filesystem_restore_failed=1
        echo "Previous application could not be restarted; application will remain stopped." >&2
      fi
    fi
  else
    stop_app || true
  fi

  if [[ "$database_restore_failed" == "1" || "$filesystem_restore_failed" == "1" ]]; then
    preserve_rollback=1
    echo "Rollback evidence preserved at $ROLLBACK_DIR." >&2
  fi
  cleanup_staging
  if [[ "$preserve_rollback" == "0" ]]; then
    rm -rf -- "$ROLLBACK_DIR"
  fi
  exit "$status"
}
trap restore_previous_release ERR

if [[ -e "$ROLLBACK_DIR" ]]; then
  echo "Rollback evidence already exists at $ROLLBACK_DIR; refusing to overwrite it." >&2
  exit 1
fi
rm -rf -- "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR" "$RELEASES_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
cp -- "$APP_DIR/.env" "$RELEASE_DIR/.env"

if [[ ! -d "$RELEASE_DIR/.next" ]]; then
  echo "Verified CI artifact is missing .next; refusing server-side rebuild." >&2
  exit 1
fi
if [[ ! -f "$RELEASE_DIR/.codexdentist-release-sha" ]]; then
  echo "Release artifact is missing its SHA manifest." >&2
  exit 1
fi
if [[ "$(tr -d '\r\n' < "$RELEASE_DIR/.codexdentist-release-sha")" != "$SHA" ]]; then
  echo "Release artifact SHA does not match requested deployment SHA." >&2
  exit 1
fi

export PATH="$NODE_BIN:$PATH"

mkdir -p "$ROLLBACK_DIR"

# Prepare dependencies and migrations outside the live application root. The
# old release keeps serving while the verified artifact is installed and the
# database snapshot is taken.
{
  cd "$RELEASE_DIR"
  "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
  "$NODE_BIN/npm" run prisma:generate
  pg_dump --format=custom --no-owner --no-privileges --file="$ROLLBACK_DIR/database.dump" "$DATABASE_URL"
  database_backup_created=1
  migration_attempted=1
  "$NODE_BIN/npx" prisma migrate deploy
  "$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
}
cd "$APP_DIR"

: > "$PROMOTED_MANIFEST"

# Set the rollback flag before stopping the live app. Every item, including
# node_modules, is moved atomically enough to restore the previous tree if the
# cutover or post-start verification fails.
cutover_started=1
stop_app

while IFS= read -r -d '' item; do
  name="${item##*/}"
  case "$name" in
    .env) continue ;;
  esac

  if [[ -e "$APP_DIR/$name" || -L "$APP_DIR/$name" ]]; then
    printf '1\t%s\n' "$name" >> "$PROMOTED_MANIFEST"
    mv -- "$APP_DIR/$name" "$ROLLBACK_DIR/$name"
  else
    printf '0\t%s\n' "$name" >> "$PROMOTED_MANIFEST"
  fi
  mv -- "$item" "$APP_DIR/$name"
done < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -print0)

start_app

check_health() {
  local response
  response="$(curl --fail --silent --show-error --location --max-time 20 "https://${DOMAIN}/api/health")" || return 1
  HEALTH_RESPONSE="$response" "$NODE_BIN/node" <<'NODE'
const health = JSON.parse(process.env.HEALTH_RESPONSE);
if (health.status !== "ok" || health.database !== "ok" || health.schema !== "ok") {
  throw new Error(`Unhealthy production response: ${JSON.stringify(health)}`);
}
NODE
}

check_readiness() {
  READINESS_URL="https://${DOMAIN}/api/readiness" JOB_SECRET="$JOB_SECRET" STRICT_READINESS=true \
    "$NODE_BIN/node" "$APP_DIR/scripts/readiness-check.mjs" >/dev/null
}
check_routes() {
  local route
  for route in / /login; do
    curl --fail --silent --show-error --location --max-time 20 \
      --output /dev/null "https://${DOMAIN}${route}" || return 1
  done
}

ready=0
for attempt in {1..12}; do
  if check_health && check_readiness && check_routes; then
    ready=1
    break
  fi
  sleep 5
done

if [[ "$ready" != "1" ]]; then
  echo "Production failed health/readiness checks after cutover." >&2
  false
fi

for attempt in {1..6}; do
  sleep 10
  if ! check_health || ! check_readiness || ! check_routes; then
    echo "Production became unhealthy during the post-deploy stability window." >&2
    false
  fi
done

deployment_succeeded=1
cutover_started=0
rm -rf -- "$ROLLBACK_DIR"
cleanup_staging
trap - ERR

echo "Codexdentist release $SHA deployed to $DOMAIN and stayed healthy for 60 seconds."
