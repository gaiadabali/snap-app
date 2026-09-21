#!/usr/bin/env bash
# Snap Apps — restore drill. Restores a dump into a THROWAWAY database and
# proves the ledger invariant survived — never the live database.
#
#   deploy/restore.sh [dump-file] [target-db]
#
# Defaults: newest /opt/snap-apps/backups/postgres/*.dump.gz into
# snapapps_restore_test. The throwaway database is dropped and recreated on
# every run, so the drill is always on the newest dump and leaves nothing
# behind but the evidence printed below.
#
# This is the part of the backup story that has never existed: a backup that
# has never been restored is a hope, not a backup. Run it after any change to
# backup.sh, Postgres major version, or storage layout — and drill it on a
# schedule; the README's drill log records when.
set -euo pipefail

BACKUP_ROOT="${SNAP_BACKUP_DIR:-/opt/snap-apps/backups}"
PG_CONTAINER="${SNAP_PG_CONTAINER:-snap-postgres}"

dump="${1:-$(ls -t "${BACKUP_ROOT}"/postgres/*.dump.gz 2>/dev/null | head -1)}"
[[ -n "${dump:-}" ]] || { echo "no dump found in ${BACKUP_ROOT}/postgres — run deploy/backup.sh first" >&2; exit 1; }
[[ -f "$dump" ]] || { echo "no such dump: $dump" >&2; exit 1; }

db="${2:-snapapps_restore_test}"
PGUSER="${PG_SUPERUSER:-postgres}"

echo "==> restoring $(basename "$dump") into throwaway database ${db}"

# Drop any previous throwaway, then create the target fresh. --clean alone
# refuses to restore into a database whose objects don't exist yet; creating
# the empty database first is the simplest deterministic path.
docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS ${db};" -c "CREATE DATABASE ${db} OWNER postgres;"

# gunzip -c into pg_restore reading custom format from stdin (single job —
# custom format from a pipe cannot use --jobs, and the drill does not need it).
gunzip -c "$dump" | docker exec -i "$PG_CONTAINER" pg_restore -U "$PGUSER" \
  --dbname="$db" --clean --if-exists --no-owner >/dev/null

# ── The proof ────────────────────────────────────────────────────────────────
# A restore is only proven by reading real data back, not by pg_restore's
# exit code. The two numbers that matter are the schema actually there and
# the ledger's split count — the double-entry ledger is the product's core
# invariant. The split count is compared against the LIVE database taken at
# the start of this run, not against a hardcoded ">0": staging before its
# first real transaction has zero splits, and zero restored must equal zero
# live. Any mismatch means the dump/restore round trip loses data.
live_splits=$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d snapapps -tAc \
  "select count(*) from transaction_splits" 2>/dev/null || echo unknown)

tables=$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$db" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
splits=$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$db" -tAc \
  "select count(*) from transaction_splits" 2>/dev/null || echo 0)

echo "==> tables restored: ${tables}"
echo "==> transaction_splits rows: restored=${splits} live-at-drill-time=${live_splits}"

if [ "${tables:-0}" -gt 0 ] && [ "$splits" = "$live_splits" ]; then
  echo "==> DRILL PASSED — dump $(basename "$dump") restores and carries the ledger exactly"
else
  echo "==> DRILL FAILED — inspect ${db} before trusting any restore story" >&2
  exit 1
fi

# Leave the throwaway in place briefly for manual inspection; the next drill
# drops it. Nothing here ever touches the live snapapps database.
