#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:?release SHA is required}"
APP_DIR="${2:?application root is required}"
ARCHIVE_NAME="${3:?archive name is required}"
DOMAIN="${4:?application domain is required}"

NODE_BIN="/opt/alt/alt-nodejs22/root/usr/bin"
ARCHIVE_PATH="$HOME/$ARCHIVE_NAME"
RELEASE_DIR="$HOME/.codexdentist-release-$SHA"
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

started=0
cleanup() {
  rm -rf -- "$RELEASE_DIR" "$ARCHIVE_PATH"
}
restart_after_failure() {
  local status=$?
  if [[ "$started" == "1" ]]; then
    cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null || true
  fi
  cleanup
  exit "$status"
}
trap restart_after_failure ERR

rm -rf -- "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
cp -- "$APP_DIR/.env" "$RELEASE_DIR/.env"

# Stop only this cPanel Node app before dependency installation/build. The old
# application root stays intact until the new source has built successfully.
cloudlinux-selector stop --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null
started=1

export PATH="$NODE_BIN:$PATH"

# Keep the physical node_modules directory required by this cPanel setup, but
# install from the exact package lock that is about to be released.
cp -- "$RELEASE_DIR/package.json" "$APP_DIR/package.json"
cp -- "$RELEASE_DIR/package-lock.json" "$APP_DIR/package-lock.json"
(
  cd "$APP_DIR"
  "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
  "$NODE_BIN/npm" run prisma:generate
)

# The build uses the already-installed physical dependency tree without copying
# it into the temporary release. This keeps shared-host inode usage bounded.
ln -s "$APP_DIR/node_modules" "$RELEASE_DIR/node_modules"
set -a
# shellcheck disable=SC1091
. "$RELEASE_DIR/.env"
set +a
(
  cd "$RELEASE_DIR"
  CODEXMED_SHARED_HOST_BUILD=true "$NODE_BIN/npm" run build
  "$NODE_BIN/npx" prisma migrate deploy
)

# Replace only application source/build artifacts. Production env, local
# storage, backups, and the physical dependency tree remain untouched.
while IFS= read -r -d '' item; do
  name="${item##*/}"
  case "$name" in
    .env|node_modules|storage|backups) continue ;;
  esac
  rm -rf -- "$APP_DIR/$name"
  cp -a -- "$item" "$APP_DIR/$name"
done < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -print0)

(
  cd "$APP_DIR"
  "$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
)

cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null
started=0
cleanup
echo "Codexdentist release $SHA deployed to $DOMAIN."
