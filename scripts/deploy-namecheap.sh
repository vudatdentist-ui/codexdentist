#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:?release SHA is required}"
APP_DIR="${2:?application root is required}"
ARCHIVE_NAME="${3:?archive name is required}"
DOMAIN="${4:?application domain is required}"

NODE_BIN="/opt/alt/alt-nodejs22/root/usr/bin"
ARCHIVE_PATH="$HOME/$ARCHIVE_NAME"
RELEASE_DIR="$HOME/.codexdentist-release-$SHA"
ROLLBACK_DIR="$APP_DIR/.codexdentist-rollback-$SHA"
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

started=0
deployment_succeeded=0
database_backup_created=0
migrations_applied=0
migration_attempted=0
preserve_rollback=0
cleanup() {
  rm -rf -- "$RELEASE_DIR" "$ARCHIVE_PATH"
  if [[ "$preserve_rollback" == "0" ]]; then
    rm -rf -- "$ROLLBACK_DIR"
  else
    echo "Rollback evidence preserved at $ROLLBACK_DIR." >&2
  fi
}
restart_after_failure() {
  local status=$?
  if [[ "$deployment_succeeded" == "1" ]]; then
    return "$status"
  fi
  preserve_rollback=1
  local database_restore_failed=0
  local dependency_restore_failed=0
  if [[ "$database_backup_created" == "1" && "$migration_attempted" == "1" ]]; then
    set +e
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
    local schema_reset_status=$?
    pg_restore --no-owner --dbname="$DATABASE_URL" "$ROLLBACK_DIR/database.dump" >/dev/null
    local restore_status=$?
    if [[ "$schema_reset_status" -ne 0 || "$restore_status" -ne 0 ]]; then
      database_restore_failed=1
      echo "Database rollback failed; application will remain stopped." >&2
    fi
    set -e
  fi
  if [[ -d "$ROLLBACK_DIR/source" ]]; then
    while IFS= read -r -d '' item; do
      name="${item##*/}"
      case "$name" in
        .env|node_modules|storage|.codexdentist-rollback-*) continue ;;
      esac
      rm -rf -- "$item"
    done < <(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print0)
    if ! cp -a -- "$ROLLBACK_DIR/source/." "$APP_DIR/"; then
      dependency_restore_failed=1
      echo "Application source rollback failed; application will remain stopped." >&2
    fi
    if [[ -x "$NODE_BIN/npm" && -f "$APP_DIR/package-lock.json" ]]; then
      if ! (cd "$APP_DIR" && "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund); then
        dependency_restore_failed=1
        echo "Dependency rollback failed; application will remain stopped." >&2
      fi
    fi
  fi
  if [[ "$database_restore_failed" == "0" && "$dependency_restore_failed" == "0" && "$started" == "1" ]]; then
    cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null || true
  fi
  cleanup
  return "$status"
}
trap restart_after_failure EXIT

rm -rf -- "$RELEASE_DIR"
rm -rf -- "$ROLLBACK_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
cp -- "$APP_DIR/.env" "$RELEASE_DIR/.env"

# Stop only this cPanel Node app before dependency installation/build. The old
# application root stays intact until the new source has built successfully.
cloudlinux-selector stop --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null
started=1

export PATH="$NODE_BIN:$PATH"

# Snapshot the complete previous application tree so a failed build, migration,
# or restart can restore one coherent release. Keep environment, dependencies,
# and patient-file storage outside the snapshot.
mkdir -p "$ROLLBACK_DIR"
mkdir -p "$ROLLBACK_DIR/source"
while IFS= read -r -d '' item; do
  name="${item##*/}"
  case "$name" in
    .env|node_modules|storage|.codexdentist-rollback-*) continue ;;
  esac
  cp -a -- "$item" "$ROLLBACK_DIR/source/"
done < <(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print0)

# Keep the physical node_modules directory required by this cPanel setup, but
# install from the exact package lock that is about to be released.
cp -- "$RELEASE_DIR/package.json" "$APP_DIR/package.json"
cp -- "$RELEASE_DIR/package-lock.json" "$APP_DIR/package-lock.json"
{
  cd "$APP_DIR"
  "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
}

# Copy source files into the real cPanel app root. This keeps `node_modules`
# physical and inside the Next.js project root; Turbopack rejects a symlink that
# points from a temporary project outside its filesystem root.
while IFS= read -r -d '' item; do
  name="${item##*/}"
  case "$name" in
    .env|node_modules|storage|backups|.next|package.json|package-lock.json) continue ;;
  esac
  rm -rf -- "$APP_DIR/$name"
  cp -a -- "$item" "$APP_DIR/$name"
done < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -print0)

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is missing from the production environment." >&2
  exit 1
fi
export CODEXMED_SHARED_HOST_BUILD=true
{
  cd "$APP_DIR"
  "$NODE_BIN/npm" run prisma:generate
  "$NODE_BIN/npm" run build
  pg_dump --format=custom --no-owner --file="$ROLLBACK_DIR/database.dump" "$DATABASE_URL"
  database_backup_created=1
  migration_attempted=1
  "$NODE_BIN/npx" prisma migrate deploy
  migrations_applied=1
}

(
  cd "$APP_DIR"
  "$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
)

cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null
for attempt in {1..12}; do
  if curl --fail --silent --show-error --max-time 15 "https://${DOMAIN}/api/health" >/dev/null \
    && READINESS_URL="https://${DOMAIN}/api/readiness" JOB_SECRET="$JOB_SECRET" STRICT_READINESS=true \
      "$NODE_BIN/node" "$APP_DIR/scripts/readiness-check.mjs" >/dev/null; then
    deployment_succeeded=1
    started=0
    cleanup
    echo "Codexdentist release $SHA deployed to $DOMAIN."
    exit 0
  fi
  sleep 5
done
echo "Production health check failed after release start." >&2
exit 1
