#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_ZIP="${1:-$HOME/storage/downloads/codexmed-os-phone-server.zip}"
APP_DIR="$HOME/codexmed-os"
DB_DIR="$PREFIX/var/lib/postgresql"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public"

echo "== CodexMed OS S22 setup =="

export DEBIAN_FRONTEND=noninteractive
APT_OPTIONS=(
  -o Dpkg::Options::=--force-confdef
  -o Dpkg::Options::=--force-confold
)

termux-wake-lock || true
termux-setup-storage || true

apt-get "${APT_OPTIONS[@]}" -f install -y || true
apt-get update -y
apt-get "${APT_OPTIONS[@]}" install -y nodejs-lts postgresql git unzip nano openssl

if [ ! -f "$APP_ZIP" ]; then
  echo "Missing app zip: $APP_ZIP"
  echo "Put codexmed-os-phone-server.zip in Android Downloads, then run this script again."
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
unzip -q "$APP_ZIP" -d "$APP_DIR"
cd "$APP_DIR"
chmod -R u+rwX "$APP_DIR"

cp .env.phone .env
node tools/s22-termux/prepare-phone-package.mjs
source "$APP_DIR/tools/s22-termux/postgres-runtime-env.sh"

if [ ! -d "$DB_DIR/base" ]; then
  initdb "$DB_DIR"
fi

pg_ctl -D "$DB_DIR" status >/dev/null 2>&1 || {
  clean_android_shmem_keys
  postgres_runtime_env pg_ctl -D "$DB_DIR" -l "$HOME/postgres.log" start
}
sleep 2

createuser -s postgres >/dev/null 2>&1 || true
psql -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
createdb -O postgres vietnam_dental_suite >/dev/null 2>&1 || true

DATABASE_URL="$DB_URL" npm install --package-lock=false
DATABASE_URL="$DB_URL" npm run prisma:generate
DATABASE_URL="$DB_URL" npx prisma migrate deploy || DATABASE_URL="$DB_URL" node tools/s22-termux/apply-raw-migrations.mjs
DATABASE_URL="$DB_URL" npm run db:seed
DATABASE_URL="$DB_URL" node node_modules/next/dist/bin/next build --webpack

cat <<EOF

Setup done.

Start the server with:
  cd $APP_DIR
  bash tools/s22-termux/start-codexmed.sh

Then open from another device on the same Wi-Fi:
  http://PHONE_WIFI_IP:3000

EOF
