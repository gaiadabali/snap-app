#!/usr/bin/env bash
# After restoring a database backup: erase again every account that deleted
# itself (group 8.3.g R2). A restore from before a deletion brings the person
# back, and the only record of who asked is the host file the api and
# erase-account.sh append to: /opt/snap-apps/data/erased/accounts.log, lines of
# `<ISO time> <user id>`. Ids already gone are skipped, so running this twice,
# or over the whole file, is safe.
#
#   DRY_RUN=1 deploy/re-erase-accounts.sh   list who is back (a read)
#   deploy/re-erase-accounts.sh             queue them (a WRITE: the owner's OK first)
#
# Prints counts and ids, never an address. Run on helios as root.
set -euo pipefail

file="${ERASED_LOG_HOST_DIR:-/opt/snap-apps/data/erased}/accounts.log"
pg_ctr="${SNAP_PG_CONTAINER:-snap-postgres}"
[ -s "$file" ] || { echo "no records in $file: nothing to re-erase"; exit 0; }

ids=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$file" | sort -u | paste -sd, -)
psql_run() { docker exec -i "$pg_ctr" psql -U postgres -d snapapps -X -At -v ON_ERROR_STOP=1 -v ids="{$ids}" "$@"; }

back=$(psql_run <<'SQL'
SELECT u.id FROM users u WHERE u.id = ANY(:'ids'::uuid[]) ORDER BY u.id;
SQL
)
if [ -z "$back" ]; then echo "none of the recorded accounts exist: nothing to do"; exit 0; fi
echo "$(echo "$back" | wc -l) recorded account(s) exist again:"; echo "$back"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "dry run: nothing written"; exit 0; fi

psql_run <<'SQL' >/dev/null
SELECT account_delete_queue(u.id) FROM users u WHERE u.id = ANY(:'ids'::uuid[]);
SQL
echo "queued. The worker erases within minutes (a teen: after the 30-day hold). Re-run with DRY_RUN=1 to confirm none are left."
