#!/usr/bin/env bash
# Delete one SnapApp account on request by email (group 8.3.a; docs/DEPLOY.md
# "Account deletion requests by email"). Calls the SAME function the app's
# Delete account button calls (account_delete_queue, migration 0055): a parent's
# teen spaces are ended first, a teen's own space goes into the 30-day hold, anyone
# else gets an `account_delete` job that the worker runs through erase_person.
#
#   deploy/erase-account.sh person@example.com            queue it (a WRITE: the owner's OK first)
#   DRY_RUN=1 deploy/erase-account.sh person@example.com  only say who it is and what would happen
#
# Run on helios as root. Check first that the request came from that address.
# Prints the user id, never the address.
set -euo pipefail

email="${1:?usage: erase-account.sh <account email>}"
pg_ctr="${SNAP_PG_CONTAINER:-snap-postgres}"
psql_run() { docker exec -i "$pg_ctr" psql -U postgres -d snapapps -X -At -v ON_ERROR_STOP=1 -v email="$email" "$@"; }

found=$(psql_run <<'SQL'
SELECT u.id,
       CASE WHEN EXISTS (SELECT 1 FROM teen_spaces t WHERE t.teen_user_id = u.id) THEN 'teen: 30-day hold, no immediate erase'
            WHEN EXISTS (SELECT 1 FROM teen_spaces t WHERE t.parent_user_id = u.id AND t.access_ended_at IS NULL) THEN 'parent: teen spaces ended first, then erased'
            ELSE 'adult: erased by the worker' END
  FROM users u WHERE u.email = :'email';
SQL
)
if [ -z "$found" ]; then echo "no account has that address (already deleted?)"; exit 1; fi
echo "user: ${found//|/ -> }"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "dry run: nothing written"; exit 0; fi

psql_run <<'SQL' >/dev/null
SELECT account_delete_queue(u.id) FROM users u WHERE u.email = :'email';
SQL
# R2 (8.3.g): the id, on the host outside Postgres, so a restore of an older backup can erase it again.
erased_dir="${ERASED_LOG_HOST_DIR:-/opt/snap-apps/data/erased}"
api_uid="${ERASED_OWNER_UID:-1001}"  # the api's uid: the directory and file must stay writable by it, never root-only
install -d -o "$api_uid" -g "$api_uid" -m 0750 "$erased_dir"
echo "$(date -u +%FT%TZ) ${found%%|*}" >> "$erased_dir/accounts.log"
chown "$api_uid:$api_uid" "$erased_dir/accounts.log"
echo "queued. The worker erases within minutes (a teen: after the 30-day hold)."
echo "Check: re-run with DRY_RUN=1; 'no account has that address' means it is done."
