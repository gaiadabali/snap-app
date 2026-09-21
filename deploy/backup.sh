#!/usr/bin/env bash
# Snap Apps — nightly backup: Postgres dump + captured-originals snapshot.
#
# Installed into the snapapps user's crontab by bootstrap.sh (03:15 daily).
# Can also be run by hand: deploy/backup.sh
#
# Two different retention stories, because they are legally different things:
#   - The Postgres dump is OPERATIONAL recovery (crash, bad migration,
#     accidental data loss). 30 daily dumps is enough to notice a problem and
#     restore from before it, and is deleted on a rolling basis — it is not
#     the retention mechanism for the underlying records.
#   - The captured originals (STORAGE_HOST_DIR) ARE the 5-year ATO legal
#     record. This script does NOT delete anything under that directory,
#     ever — it only produces an additional dated tar snapshot to protect
#     against host disk failure. The primary durable copy is the bind-mounted
#     host directory itself; ONE box holding both the only copy and its only
#     backup is a known gap — see docs/DEPLOY.md §9 for the offsite-replication
#     follow-up (rclone/restic to object storage) this does not yet do.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
ENV_FILE="${HERE}/.env"
[[ -f "${ENV_FILE}" ]] || { echo "deploy/.env not found" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

BACKUP_ROOT="${SNAP_BACKUP_DIR:-/opt/snap-apps/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PG_DIR="${BACKUP_ROOT}/postgres"
STORAGE_DIR="${BACKUP_ROOT}/storage-snapshots"
mkdir -p "${PG_DIR}" "${STORAGE_DIR}"

echo "==> pg_dump (${STAMP})"
# Write to a temp file and rename only on success: an interrupted cron must
# never leave something restore.sh might later pick as "newest". Custom
# format (pg_restore) rather than plain SQL — it is compressed, restorable
# with selective --section, and cannot be half-applied by psql.
tmp="${PG_DIR}/snapapps-${STAMP}.dump.tmp"
docker exec "${SNAP_PG_CONTAINER:-snap-postgres}" pg_dump -U postgres --format=custom snapapps \
  > "$tmp"
gzip -f "$tmp" && mv "${tmp}.gz" "${PG_DIR}/snapapps-${STAMP}.dump.gz"
echo "    wrote ${PG_DIR}/snapapps-${STAMP}.dump.gz"

echo "==> pruning Postgres dumps older than 30 days (operational recovery window only)"
find "${PG_DIR}" -name '*.dump.gz' -mtime +30 -delete

echo "==> tar snapshot of captured originals (${STORAGE_HOST_DIR:?set in deploy/.env})"
tar -czf "${STORAGE_DIR}/storage-${STAMP}.tar.gz" -C "$(dirname "${STORAGE_HOST_DIR}")" "$(basename "${STORAGE_HOST_DIR}")"
echo "    wrote ${STORAGE_DIR}/storage-${STAMP}.tar.gz"
echo "    (nothing under ${STORAGE_HOST_DIR} itself was touched or deleted — that is the primary 5-year record)"

echo "==> pruning storage snapshots older than 90 days (the snapshots, never the originals)"
find "${STORAGE_DIR}" -name '*.tar.gz' -mtime +90 -delete

# ── Weekly base backup for PITR ─────────────────────────────────────────────
# The nightly pg_dump is operational recovery down to "last night". Point-in-
# time recovery (to 14:32, before someone deleted the wrong thing) needs a
# base backup plus the WAL archive (see docker-compose.yml, wal_archive_data).
# One base backup per week is enough: replaying a week of archived WAL is
# bounded work, and each base backup is a full copy — daily ones would be
# storage nobody replays. Sundays only; the WAL archive fills the gap.
if [ "$(date -u +%u)" = "7" ]; then
  echo "==> pg_basebackup for PITR (${STAMP})"
  BASE_DIR="${BACKUP_ROOT}/basebackups"
  mkdir -p "$BASE_DIR"
  base_tmp="${BASE_DIR}/base-${STAMP}.tmp"
  docker exec "${SNAP_PG_CONTAINER:-snap-postgres}" pg_basebackup -U postgres \
    -D - -X stream --format=tar > "$base_tmp.tar.gz.tmp" 2>"${BACKUP_ROOT}/basebackup.err" \
    && mv "$base_tmp.tar.gz.tmp" "${BASE_DIR}/base-${STAMP}.tar.gz" \
    || { echo "    pg_basebackup FAILED — see ${BACKUP_ROOT}/basebackup.err" >&2; rm -f "$base_tmp.tar.gz.tmp"; exit 1; }
  echo "    wrote ${BASE_DIR}/base-${STAMP}.tar.gz"
  find "$BASE_DIR" -name 'base-*.tar.gz' -mtime +35 -delete
fi

echo "done."
