#!/bin/sh
# Daily pg_dump → /backups/YYYY-MM-DD/bsn_lacak.sql.gz
# Rotates anything older than $RETENTION_DAYS days.

set -eu

RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
DEST_DIR="/backups/${STAMP}"
DEST="${DEST_DIR}/${PGDATABASE}.sql.gz"

mkdir -p "${DEST_DIR}"

echo "[backup] $(date -u) → ${DEST}"

# --clean and --if-exists make the dump idempotent on restore.
# Compression at gzip default (-6) is a reasonable speed/size trade-off.
pg_dump --clean --if-exists --no-owner --no-acl \
  | gzip -6 > "${DEST}.tmp"
mv "${DEST}.tmp" "${DEST}"

SIZE="$(du -h "${DEST}" | cut -f1)"
echo "[backup] wrote ${SIZE}"

# Rotation
echo "[backup] pruning backups older than ${RETENTION_DAYS}d"
find /backups -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +

echo "[backup] done"
