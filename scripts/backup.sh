#!/usr/bin/env bash
# PhotoApp Backup Script
# Usage: ./scripts/backup.sh [--dest /path/to/backups] [--retain-days 30]
#
# Backs up:
#   1. PostgreSQL database (pg_dump → gzip)
#   2. Uploads volume (rsync or tar)
#   3. Thumbnails volume (optional, regeneratable)
#
# Environment variables (or set in .env):
#   BACKUP_DEST     - Destination directory (default: /opt/photoapp/backups)
#   RETAIN_DAYS     - Days to keep backups (default: 30)
#   COMPOSE_FILE    - Path to docker-compose.yml (default: auto-detect)
#   POSTGRES_USER   - DB user (default: photoapp)
#   POSTGRES_DB     - DB name (default: photoapp)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"

# Defaults
BACKUP_DEST="${BACKUP_DEST:-${COMPOSE_DIR}/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
POSTGRES_USER="${POSTGRES_USER:-photoapp}"
POSTGRES_DB="${POSTGRES_DB:-photoapp}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DEST}/${TIMESTAMP}"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case $1 in
    --dest)    BACKUP_DEST="$2"; BACKUP_DIR="${BACKUP_DEST}/${TIMESTAMP}"; shift 2 ;;
    --retain-days) RETAIN_DAYS="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

log "Starting PhotoApp backup → ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# ── 1. PostgreSQL dump ────────────────────────────────────────────────────────
log "Backing up PostgreSQL database '${POSTGRES_DB}'..."

DB_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"

docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip -9 > "${DB_FILE}"

DB_SIZE=$(du -sh "${DB_FILE}" | cut -f1)
log "  Database dump complete: ${DB_FILE} (${DB_SIZE})"

# ── 2. Uploads volume ─────────────────────────────────────────────────────────
log "Backing up uploads volume..."

UPLOADS_FILE="${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"

# Get the actual volume path from Docker
UPLOADS_VOLUME=$(docker volume inspect photoapp_upload_data --format '{{.Mountpoint}}' 2>/dev/null || true)

if [[ -n "$UPLOADS_VOLUME" && -d "$UPLOADS_VOLUME" ]]; then
  tar -czf "${UPLOADS_FILE}" -C "${UPLOADS_VOLUME}" .
  UPLOADS_SIZE=$(du -sh "${UPLOADS_FILE}" | cut -f1)
  log "  Uploads backup complete: ${UPLOADS_FILE} (${UPLOADS_SIZE})"
else
  err "Could not locate uploads volume. Skipping uploads backup."
fi

# ── 3. Thumbnails volume (optional) ──────────────────────────────────────────
# Thumbnails are regeneratable from uploads, so we skip by default.
# Uncomment to include:
#
# log "Backing up thumbnails volume..."
# THUMB_VOLUME=$(docker volume inspect photoapp_thumbnail_data --format '{{.Mountpoint}}' 2>/dev/null || true)
# if [[ -n "$THUMB_VOLUME" && -d "$THUMB_VOLUME" ]]; then
#   THUMB_FILE="${BACKUP_DIR}/thumbnails_${TIMESTAMP}.tar.gz"
#   tar -czf "${THUMB_FILE}" -C "${THUMB_VOLUME}" .
#   log "  Thumbnails backup complete: ${THUMB_FILE}"
# fi

# ── 4. Write manifest ─────────────────────────────────────────────────────────
MANIFEST="${BACKUP_DIR}/MANIFEST.txt"
cat > "${MANIFEST}" <<EOF
PhotoApp Backup Manifest
========================
Timestamp : ${TIMESTAMP}
Host      : $(hostname)
Date      : $(date)

Files:
  $(ls -lh "${BACKUP_DIR}" | tail -n +2)

Restore:
  1. Restore database:
     zcat ${DB_FILE} | docker compose exec -T postgres psql -U ${POSTGRES_USER} ${POSTGRES_DB}

  2. Restore uploads:
     UPLOADS_VOLUME=\$(docker volume inspect photoapp_upload_data --format '{{.Mountpoint}}')
     tar -xzf ${UPLOADS_FILE} -C \$UPLOADS_VOLUME

  3. Restart containers:
     docker compose up -d
EOF

log "  Manifest written: ${MANIFEST}"

# ── 5. Prune old backups ──────────────────────────────────────────────────────
log "Pruning backups older than ${RETAIN_DAYS} days..."
find "${BACKUP_DEST}" -maxdepth 1 -type d -mtime "+${RETAIN_DAYS}" -exec rm -rf {} + 2>/dev/null || true

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
log "Backup complete. Total size: ${TOTAL_SIZE}"
log "Location: ${BACKUP_DIR}"
