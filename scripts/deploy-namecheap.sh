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

exec 9>"$LOCK_PATH"
if ! flock -n 9; then
  echo "Another Codexdentist deployment is already running." >&2
  exit 1
fi

started=0
cleanup() {
  rm -rf -- "$RELEASE_DIR" "$ARCHIVE_PATH" "$ROLLBACK_DIR"
}
restart_after_failure() {
  local status=$?
  if [[ -d "$ROLLBACK_DIR" ]]; then
    rm -rf -- "$APP_DIR/.next" "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
    for item in .next package.json package-lock.json; do
      if [[ -e "$ROLLBACK_DIR/$item" || -L "$ROLLBACK_DIR/$item" ]]; then
        mv -- "$ROLLBACK_DIR/$item" "$APP_DIR/$item"
      fi
    done
  fi
  if [[ "$started" == "1" ]]; then
    cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null || true
  fi
  cleanup
  exit "$status"
}
trap restart_after_failure ERR

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

# Keep the previous compiled app and package manifests available if the new
# build fails. The source tree can be updated before building because Next.js
# serves the compiled `.next` output, not the source files directly.
mkdir -p "$ROLLBACK_DIR"
for item in .next package.json package-lock.json; do
  if [[ -e "$APP_DIR/$item" || -L "$APP_DIR/$item" ]]; then
    mv -- "$APP_DIR/$item" "$ROLLBACK_DIR/$item"
  fi
done

# Keep the physical node_modules directory required by this cPanel setup, but
# install from the exact package lock that is about to be released.
cp -- "$RELEASE_DIR/package.json" "$APP_DIR/package.json"
cp -- "$RELEASE_DIR/package-lock.json" "$APP_DIR/package-lock.json"
(
  cd "$APP_DIR"
  "$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
  "$NODE_BIN/npm" run prisma:generate
)

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
(
  cd "$APP_DIR"
  CODEXMED_SHARED_HOST_BUILD=true "$NODE_BIN/npm" run build
  "$NODE_BIN/npx" prisma migrate deploy
)

(
  cd "$APP_DIR"
  "$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
)

rm -rf -- "$ROLLBACK_DIR"
cloudlinux-selector start --json --interpreter nodejs --domain "$DOMAIN" --app-root "$APP_DIR" >/dev/null 2>&1 </dev/null
started=0
cleanup
echo "Codexdentist release $SHA deployed to $DOMAIN."
