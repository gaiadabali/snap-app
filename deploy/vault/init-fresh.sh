#!/usr/bin/env bash
# Initialises a BRAND-NEW Vault: the "start fresh" path. Safe by construction:
# it refuses unless Vault reports initialized:false, so it can never touch a
# live Vault. It also never deletes or moves the vault_data volume; clearing an
# old Vault out of the way is a separate, manual step.
#
# What it does (each step prints only its name and OK/FAILED; no secret is ever
# printed):
#   1. checks Vault is not initialised, and that no shares file already exists;
#   2. sys/init with 3 shares, threshold 2, into a root-only temp file (umask
#      077), never echoed;
#   3. shares 1 and 2 -> SHARES_FILE (600), for the auto-unseal timer;
#      share 3     -> SHARE3_FILE (600), which the OWNER must copy off the box
#      and delete: it is the part of the key that is not on this host;
#   4. unseals with shares 1 and 2, then does the same transit / policy /
#      app-token / .env steps as mint-app-token.sh (shared code in lib.sh)
#      using the initial root token;
#   5. revokes the root token and shreds the temp file, even on failure (trap).
#
# Share and token handling follows lib.sh: nothing secret in argv.
#
# Environment (defaults are helios): VAULT_CONTAINER, SECRETS_DIR, SHARES_FILE,
# SHARE3_FILE, APP_ENV_FILE, UNSEAL_ALLOW_ANY_OWNER=1 (laptop tests only, never
# on helios).
# shellcheck disable=SC2015  # "cmd && echo OK || fail": the echo cannot fail
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${HERE}/lib.sh"

umask 077
# shellcheck disable=SC2034 # read by the functions in lib.sh
ROOT_TOK=""
RESP_FILE=""
cleanup() {
  revoke_root_token
  if [[ -n "$RESP_FILE" && -e "$RESP_FILE" ]]; then
    shred -u "$RESP_FILE" 2>/dev/null || rm -f "$RESP_FILE"
  fi
}
trap cleanup EXIT

vault_container_running || { echo "step: vault container ${VAULT_CONTAINER} ... FAILED (not running)" >&2; exit 1; }

status="$(vault_get sys/seal-status 2>/dev/null)" || { echo "step: vault reachable ... FAILED" >&2; exit 1; }
if [[ "$status" != *'"initialized":false'* ]]; then
  echo "step: check vault is uninitialised ... REFUSED (it is already initialised; this script never touches a live Vault)" >&2
  exit 1
fi
echo "step: check vault is uninitialised ... OK"

for f in "$SHARES_FILE" "$SHARE3_FILE"; do
  [[ ! -e "$f" ]] || { echo "step: check ${f} is absent ... REFUSED (exists; move it aside by hand first)" >&2; exit 1; }
done
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"

RESP_FILE="$(mktemp)"
printf '{"secret_shares":3,"secret_threshold":2}' | vault_post_stdin sys/init > "$RESP_FILE" 2>/dev/null \
  || { echo "step: initialise vault ... FAILED" >&2; exit 1; }
echo "step: initialise vault (3 shares, threshold 2) ... OK"

# keys_base64 is a JSON array of 3 strings: split it into lines.
keys="$(sed -n 's/.*"keys_base64":\["\([^]]*\)"\].*/\1/p' < "$RESP_FILE" | sed 's/","/\n/g')"
[[ "$(printf '%s\n' "$keys" | grep -c .)" == "3" ]] || { echo "step: parse shares ... FAILED" >&2; exit 1; }
ROOT_TOK="$(sed -n 's/.*"root_token":"\([^"]*\)".*/\1/p' < "$RESP_FILE")"
[[ -n "$ROOT_TOK" ]] || { echo "step: parse root token ... FAILED" >&2; exit 1; }

# Written by builtins into 600 files (umask 077): no argv, no echo.
printf '%s\n' "$keys" | sed -n '1,2p' > "$SHARES_FILE"
printf '%s\n' "$keys" | sed -n '3p' > "$SHARE3_FILE"
keys=""
chmod 600 "$SHARES_FILE" "$SHARE3_FILE"
echo "step: write shares 1-2 to ${SHARES_FILE} ... OK"
echo "step: write share 3 to ${SHARE3_FILE} ... OK"

unseal_from_file && echo "step: unseal ... OK" || { echo "step: unseal ... FAILED" >&2; exit 1; }

provision_app_token || exit 1

cat <<NOTICE

ACTION REQUIRED (owner): share 3 is in ${SHARE3_FILE}.
  Copy it OFF this box to a safe place, then delete it here:
    shred -u ${SHARE3_FILE}
  Until you do, this host holds all three shares. Shares 1-2 stay in
  ${SHARES_FILE} so the unseal timer can work; that file is excluded from
  backup.sh and offsite.sh on purpose.
NOTICE

print_next_step
