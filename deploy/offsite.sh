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
#   - backups/vault         — sealed Vault key material (useless without the unseal shares)
#   - backups/basebackups   — the weekly PITR base + WAL archive companion
#   - data/storage          — the captured originals: the 5-year ATO legal
#                             record. The host directory is primary; this is
#                             its second copy on a second continent.
#   - wal archive           — the docker volume snap-apps_wal_archive_data,
#                             resolved on the host (override: WAL_ARCHIVE_DIR)
#
# Verify after any first run (this is the drill that makes it a backup):
#   restic snapshots                       — lists the pushed paths
#   restic restore latest --target /tmp/verify --include /opt/snap-apps/data/storage
#   cmp a restored sampled file against its original
set -euo pipefail

# An explicit PATH, because cron gives this job none worth having. Ubuntu's
# cron takes PATH from PAM, and on this host /etc/environment holds only
# LC_ALL, so the job starts with no usable PATH. bash still finds `restic`
# through its built-in default search path, but restic is a Go program and
# looks for `ssh` (to open the sftp: repository) in the PATH it inherited,
# which is empty. Every nightly run since install died with:
#   Fatal: create repository at sftp:sumopod-backup:/srv/snap-backups/restic
#   failed: exec: "ssh": executable file not found in $PATH
# An interactive SSH shell has a full PATH, which is why the same command
# worked by hand.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

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

# First run: one-time repository initialisation, but ONLY when restic says the
# repository does not exist. The old test (`restic snapshots` failing → init)
# treated every failure as "no repository", so a missing ssh binary, a wrong
# password or an unreachable host all became a confusing `restic init` error
# that hid the real cause. Probe with `cat config` (the one file that makes a
# repository a repository), keep stderr, and decide on that:
#   - success                  → the repository is there, carry on
#   - "does not exist" wording → init it
#   - anything else            → print restic's own error and stop
# restic 0.16 (what apt ships on Ubuntu 24.04) has no distinct exit code for a
# missing repository and says "Is there a repository at the following
# location?" or "config: file does not exist"; restic >= 0.17 also exits 10.
# Both are accepted. Never init on an unknown error.
probe_err="$(mktemp)"
trap 'rm -f "$probe_err"' EXIT
set +e
restic cat config >/dev/null 2>"$probe_err"
probe_rc=$?
set -e
if [[ $probe_rc -ne 0 ]]; then
  if [[ $probe_rc -eq 10 ]] \
      || grep -qiE 'Is there a repository at the following location|repository does not exist|config: file does not exist|unable to open config file.*(does not exist|no such file)' "$probe_err"; then
    echo "==> initialising restic repository ${RESTIC_REPOSITORY}"
    restic init
  else
    echo "restic could not open ${RESTIC_REPOSITORY} (exit ${probe_rc}); NOT initialising on an unknown error:" >&2
    cat "$probe_err" >&2
    exit 1
  fi
fi

# The Postgres WAL archive joins the pushed paths when it can be found. A base
# backup alone restores to the moment the base was taken; point-in-time restore
# (to 14:32, before the wrong delete) off the box needs the base backup AND
# every WAL segment archived since, and this disk is the thing we are insuring
# against losing. The archive lives in a docker volume (wal_archive_data), so
# ask docker where it is on the host (override: WAL_ARCHIVE_DIR). Included only
# if that resolves to a real directory: a host without the volume still gets
# its other paths pushed.
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-$(docker volume inspect -f '{{.Mountpoint}}' snap-apps_wal_archive_data 2>/dev/null || true)}"
extra_paths=()
if [[ -n "$WAL_ARCHIVE_DIR" && -d "$WAL_ARCHIVE_DIR" ]]; then
  extra_paths+=("$WAL_ARCHIVE_DIR")
else
  echo "    (WAL archive directory not found — pushing without it)" >&2
fi

# The Vault unseal shares (/etc/snap-apps/secrets/vault-unseal) are deliberately
# NOT in the paths below and must never be added: they live under ${SECRETS_DIR},
# which nothing pushed here touches. backups/vault holds Vault's SEALED data;
# shipping the shares beside it would make the offsite copy the key and the
# lock in one envelope. See deploy/vault/README.md.

echo "==> pushing backups + storage originals off the box"
restic backup \
  /opt/snap-apps/backups/postgres \
  /opt/snap-apps/backups/basebackups \
  /opt/snap-apps/backups/vault \
  /opt/snap-apps/data/storage \
  "${extra_paths[@]}" 2>&1 | tail -3

echo "==> applying retention: 7 daily, 12 monthly, prune"
restic forget --keep-daily 7 --keep-monthly 12 --prune 2>&1 | tail -3

# The success stamp, written only now: set -e means any earlier failure (push,
# forget, an unreachable repo) exits before this line, so the stamp's age is
# "time since the last COMPLETE run". monitor/alert.sh reads it (cheaply, every
# 10 minutes, without touching restic or the network) and alerts past 26 hours.
# Path overridable for tests.
date -u +%FT%TZ > "${OFFSITE_STAMP:-/opt/snap-apps/backups/.offsite-last-ok}"

echo "==> offsite replication done."
