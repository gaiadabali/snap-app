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
docker exec "${SNAP_PG_CONTAINER:-snap-postgres}" pg_dump -U postgres --format=custom snapapps \
  > "${PG_DIR}/snapapps-${STAMP}.dump"
gzip -f "${PG_DIR}/snapapps-${STAMP}.dump"
echo "    wrote ${PG_DIR}/snapapps-${STAMP}.dump.gz"

echo "==> pruning Postgres dumps older than 30 days (operational recovery window only)"
find "${PG_DIR}" -name '*.dump.gz' -mtime +30 -delete

echo "==> tar snapshot of captured originals (${STORAGE_HOST_DIR:?set in deploy/.env})"
tar -czf "${STORAGE_DIR}/storage-${STAMP}.tar.gz" -C "$(dirname "${STORAGE_HOST_DIR}")" "$(basename "${STORAGE_HOST_DIR}")"
echo "    wrote ${STORAGE_DIR}/storage-${STAMP}.tar.gz"
echo "    (nothing under ${STORAGE_HOST_DIR} itself was touched or deleted — that is the primary 5-year record)"

echo "==> pruning storage snapshots older than 90 days (the snapshots, never the originals)"
find "${STORAGE_DIR}" -name '*.tar.gz' -mtime +90 -delete

echo "done."
