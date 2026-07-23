#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite"
BACKUP_DIR="$HOME/storage/downloads/codexmed-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"

mkdir -p "$BACKUP_DIR"
pg_dump -Fc "$DB_URL" | gzip > "$BACKUP_DIR/codexmed-postgres-$STAMP.dump.gz"

echo "Backup created:"
echo "$BACKUP_DIR/codexmed-postgres-$STAMP.dump.gz"
