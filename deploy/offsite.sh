#!/usr/bin/env bash
# Snap Apps — offsite replication. Nightly, after backup.sh: push the DB
# dumps, the storage originals, and the WAL archive off the box, so that the
# one disk holding both the data and its only backup stops being a single
# point of failure.
#
# Requires restic and a repository. Secrets live on the host, never in this
# repo (deploy/.gitignore rule: "No secret has ever lived in this repo"):
#   /etc/snap-apps/secrets/restic          — the repository password, chmod 600
#   /etc/snap-apps/secrets/restic.env      — RESTIC_REPO / RESTIC_* auth env, chmod 600
#
# Target of choice: restic → Backblaze B2 or any S3-compatible store (the
# cheapest honest option for a ~1 GB-and-growing originals set + dumps; the
# 2026-09-21 readiness audit's item 4). RESTIC_REPO example:
#   RESTIC_REPO="b2:<bucket>:<path>"  RESTIC_ACCOUNT=<keyID>  RESTIC_ACCOUNT_KEY=<key>
# or  RESTIC_REPO="s3:https://s3.<region>.amazonaws.com/<bucket>"  AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#
# What gets pushed, and why each of the three:
#   - backups/postgres      — operational recovery dumps (30-day window)
#   - backups/basebackups   — the weekly PITR base + WAL archive companion
#   - data/storage          — the captured originals: the 5-year ATO legal
#                             record. The host directory is primary; this is
#                             its second copy on a second continent.
#   - wal-archive volume is swept by deploy/pull-wal-archive.sh if present.
#
# Verify after any first run (this is the drill that makes it a backup):
#   restic snapshots                       — lists the pushed paths
#   restic restore latest --target /tmp/verify --include /opt/snap-apps/data/storage
#   cmp a restored sampled file against its original
set -euo pipefail

SECRETS_DIR="/etc/snap-apps/secrets"
PW_FILE="${SECRETS_DIR}/restic"
ENV_FILE="${SECRETS_DIR}/restic.env"

[[ -f "$PW_FILE" ]] || { echo "restic password file $PW_FILE missing — see header comment" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "restic env file $ENV_FILE missing — see header comment" >&2; exit 1; }

command -v restic >/dev/null 2>&1 || { echo "restic not installed — see https://restic.readthedocs.io" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; source "$ENV_FILE"; set +a
export RESTIC_PASSWORD_FILE="$PW_FILE"
export RESTIC_REPOSITORY="${RESTIC_REPO:?set RESTIC_REPO in $ENV_FILE}"

# First run: one-time repository initialisation (idempotent — restic refuses
# to re-init an existing repo, which is the check itself).
if ! restic snapshots >/dev/null 2>&1; then
  echo "==> initialising restic repository ${RESTIC_REPOSITORY}"
  restic init
fi

echo "==> pushing backups + storage originals off the box"
restic backup \
  /opt/snap-apps/backups/postgres \
  /opt/snap-apps/backups/basebackups \
  /opt/snap-apps/data/storage 2>&1 | tail -3

echo "==> applying retention: 7 daily, 12 monthly, prune"
restic forget --keep-daily 7 --keep-monthly 12 --prune 2>&1 | tail -3

echo "==> offsite replication done."
