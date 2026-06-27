#!/bin/sh
# Backup trackbox SQLite database
# Usage: Run via cron on docker host
# 0 3 * * * /path/to/backup.sh

set -e
DB="/srv/docker-data/volumes/n8n/trackbox/trackbox.db"
BACKUP_DIR="/srv/docker-data/volumes/n8n/trackbox/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "${BACKUP_DIR}"
sqlite3 "${DB}" ".backup '${BACKUP_DIR}/trackbox_${TIMESTAMP}.db'"

# Keep only last 7 backups
ls -t "${BACKUP_DIR}"/trackbox_*.db | tail -n +8 | xargs rm -f 2>/dev/null || true

echo "Backup complete: ${BACKUP_DIR}/trackbox_${TIMESTAMP}.db"
