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

exec 9>"$LOCK_PATH"
if ! flock -n 9; then
  echo "Another Codexdentist deployment is already running." >&2
  exit 1
fi

cutover_started=0

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

  if [[ "$cutover_started" == "1" ]]; then
    echo "Deployment failed after cutover started; restoring previous release." >&2
    stop_app || true

    if [[ -f "$PROMOTED_MANIFEST" ]]; then
      while IFS=$'\t' read -r had_old name; do
        [[ -n "$name" ]] || continue

        if [[ "$had_old" == "1" ]]; then
          if [[ -e "$ROLLBACK_DIR/$name" || -L "$ROLLBACK_DIR/$name" ]]; then
            rm -rf -- "$APP_DIR/$name"
            mv -- "$ROLLBACK_DIR/$name" "$APP_DIR/$name" || true
          fi
        else
          rm -rf -- "$APP_DIR/$name"
        fi
      done < "$PROMOTED_MANIFEST"
    fi

    # Defensive fallback for any item moved to rollback but not restored above.
    if [[ -d "$ROLLBACK_DIR" ]]; then
      while IFS= read -r -d '' item; do
        name="${item##*/}"
        [[ "$name" == ".promoted-items" ]] && continue
        rm -rf -- "$APP_DIR/$name"
        mv -- "$item" "$APP_DIR/$name" || true
      done < <(find "$ROLLBACK_DIR" -mindepth 1 -maxdepth 1 -print0)
    fi

    start_app || true
  fi

  cleanup_staging
  rm -rf -- "$ROLLBACK_DIR"
  exit "$status"
}
trap restore_previous_release ERR

rm -rf -- "$RELEASE_DIR" "$ROLLBACK_DIR"
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

# Prepare the complete runtime tree while the currently deployed application
# continues serving traffic. The release artifact was already built and tested
# in CI, so shared hosting no longer performs a production Next.js build.
(
  cd "$RELEASE_DIR"
  "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
  "$NODE_BIN/npm" run prisma:generate

  # Migrations run while the old application is still live. CI rejects contract
  # migrations, so the previous release remains schema-compatible if cutover
  # must be rolled back.
  "$NODE_BIN/npx" prisma migrate deploy

  "$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
)

mkdir -p "$ROLLBACK_DIR"
: > "$PROMOTED_MANIFEST"

# Stop only for the final filesystem cutover. Set the rollback flag before the
# stop command so even a partially successful stop is recovered by the ERR trap.
cutover_started=1
stop_app

while IFS= read -r -d '' item; do
  name="${item##*/}"
  case "$name" in
    .env) continue ;;
  esac

  if [[ -e "$APP_DIR/$name" || -L "$APP_DIR/$name" ]]; then
    # Record intent before moving the old item. If the move itself fails, the
    # rollback handler sees no backup and leaves the still-live old item alone.
    printf '1\t%s\n' "$name" >> "$PROMOTED_MANIFEST"
    mv -- "$APP_DIR/$name" "$ROLLBACK_DIR/$name"
  else
    # A new-only item can always be removed safely during rollback, even if its
    # promotion fails halfway through.
    printf '0\t%s\n' "$name" >> "$PROMOTED_MANIFEST"
  fi

  mv -- "$item" "$APP_DIR/$name"
done < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -print0)

start_app

check_health() {
  local response
  response="$(curl --fail --silent --show-error --location --max-time 20 \
    "https://${DOMAIN}/api/health")" || return 1
  HEALTH_RESPONSE="$response" "$NODE_BIN/node" <<'NODE'
const health = JSON.parse(process.env.HEALTH_RESPONSE);
if (health.status !== "ok" || health.database !== "ok" || health.schema !== "ok") {
  throw new Error(`Unhealthy production response: ${JSON.stringify(health)}`);
}
NODE
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
  if check_health && check_routes; then
    ready=1
    break
  fi
  sleep 5
done

if [[ "$ready" != "1" ]]; then
  echo "Production failed readiness checks after cutover." >&2
  false
fi

for attempt in {1..6}; do
  sleep 10
  if ! check_health || ! check_routes; then
    echo "Production became unhealthy during the post-deploy stability window." >&2
    false
  fi
done

# Only now is the release accepted and rollback state discarded.
cutover_started=0
rm -rf -- "$ROLLBACK_DIR"
cleanup_staging
trap - ERR

echo "Codexdentist release $SHA deployed to $DOMAIN and stayed healthy for 60 seconds."
