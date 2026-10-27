#!/usr/bin/env bash
# Database backup: a compressed pg_dump in /opt/unamart/backups, kept 14
# days, and copied off the server when BACKUP_REMOTE is set (rclone).
# Runs every night from cron (see VPS_GUIDE.md) and before every API deploy.
#
#   ./backup.sh            # nightly
#   ./backup.sh pre-deploy # labelled copy
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

LABEL="${1:-nightly}"
KEEP_DAYS=14
mkdir -p backups
FILE="backups/unamart-$(date +%Y%m%d-%H%M%S)-${LABEL}.dump"

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$FILE"

# A backup you can't read is not a backup.
if [ ! -s "$FILE" ] || ! docker compose exec -T db pg_restore --list < "$FILE" > /dev/null; then
  echo "!! Backup $FILE is empty or unreadable" >&2
  rm -f "$FILE"
  exit 1
fi
echo "==> Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

find backups -name 'unamart-*.dump' -mtime +"$KEEP_DAYS" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$FILE" "$BACKUP_REMOTE"
  echo "==> Copied to $BACKUP_REMOTE"
else
  echo "   (BACKUP_REMOTE is empty — this backup exists only on this server)"
fi
