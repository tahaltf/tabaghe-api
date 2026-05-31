#!/usr/bin/env bash
# بک‌اپ Postgres طبقه — روی هاست VPS (خارج یا داخل کانتینر با pg_dump)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tabagheh/postgres}"
POSTGRES_USER="${POSTGRES_USER:-tabagheh_maindb}"
POSTGRES_DB="${POSTGRES_DB:-tabagheh_db}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

resolve_postgres_container() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    echo "$POSTGRES_CONTAINER"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    for c in tabagheh-db tabagheh_postgres postgres_db; do
      if docker ps --format '{{.Names}}' | grep -qx "$c"; then
        echo "$c"
        return
      fi
    done
  fi
  echo "tabagheh_postgres"
}

POSTGRES_CONTAINER="$(resolve_postgres_container)"

TS="$(date +%F_%H%M)"
FILE="$BACKUP_DIR/tabagheh_db_${TS}.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$FILE"
elif command -v pg_dump >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump "$DATABASE_URL" --format=custom --file="$FILE"
elif command -v pg_dump >/dev/null 2>&1; then
  : "${PGHOST:?PGHOST required when not using docker}"
  : "${PGUSER:?PGUSER required}"
  : "${PGDATABASE:?PGDATABASE required}"
  pg_dump -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" --format=custom --file="$FILE"
else
  echo "Neither docker+container nor pg_dump available" >&2
  exit 1
fi

find "$BACKUP_DIR" -type f -name 'tabagheh_db_*.dump' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

echo "$FILE"
