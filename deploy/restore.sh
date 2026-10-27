#!/usr/bin/env bash
# Restores the database from a backup file. DESTRUCTIVE: replaces all
# current data. The shop is offline (API + web stopped) while it runs.
#
#   ./restore.sh backups/unamart-20261101-030000-nightly.dump
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

FILE="${1:?usage: restore.sh <backup.dump>}"
[ -s "$FILE" ] || { echo "No such backup: $FILE" >&2; exit 1; }

echo "This REPLACES the database '$POSTGRES_DB' with $FILE."
echo "Everything since that backup (orders, customers, stock) is lost."
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "==> Safety backup of the current data first"
./backup.sh before-restore

docker compose stop web api
docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$FILE"
docker compose start api web
echo "==> Restored from $FILE. Check https://api.${SITE_DOMAIN}/health and place a test order."
