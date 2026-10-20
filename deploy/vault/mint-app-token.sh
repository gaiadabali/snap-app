#!/usr/bin/env bash
# Mints a NEW app token for the snap-app policy and puts it in deploy/.env,
# without any human handling a secret and without printing one.
#
# Use it when the app's token is dead (the 72h period lapsed because renewals
# failed or the host was down) and the Vault itself is fine. It does not touch
# data: transit/snap-dek and everything wrapped under it are left alone. To
# start a brand-new Vault instead, see init-fresh.sh.
#
# What it does, in order (each step prints only its name and OK/FAILED):
#   1. unseals Vault from the shares file if it is sealed;
#   2. generates a TEMPORARY ROOT TOKEN from two shares (sys/generate-root);
#   3. ensures the transit mount and the snap-dek key exist, and writes the
#      snap-app policy (identical to deploy/vault/README.md);
#   4. creates an ORPHAN periodic (72h) token with that policy;
#   5. backs up deploy/.env to .env.bak-<UTC stamp>-vault-token (600) and
#      replaces its VAULT_TOKEN= line in place (owner and mode kept);
#   6. revokes the root token. A trap does this even if a step above failed.
#
# How the secrets stay out of argv (helios is shared; /proc/*/cmdline is
# world-readable): shares go over stdin; the root token lives in a shell
# variable and reaches the vault CLI as an environment variable; the generate-
# root decode is done in bash arithmetic rather than with `vault operator
# generate-root -decode=... -otp=...`, which would put the one-time pad and the
# encoded token in argv together. Details in lib.sh.
#
# It does NOT restart containers; it prints the next step instead.
#
# Environment (defaults are helios): VAULT_CONTAINER, SHARES_FILE, APP_ENV_FILE,
# UNSEAL_ALLOW_ANY_OWNER=1 (laptop tests only, never on helios).
# shellcheck disable=SC2015  # "cmd && echo OK || fail": the echo cannot fail
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${HERE}/lib.sh"

# shellcheck disable=SC2034 # read by the functions in lib.sh
ROOT_TOK=""
# Revoke the root token on every way out, success or not.
trap 'revoke_root_token' EXIT

vault_container_running || { echo "step: vault container ${VAULT_CONTAINER} ... FAILED (not running)" >&2; exit 1; }
check_shares_file || { echo "step: shares file ... FAILED" >&2; exit 1; }
echo "step: shares file ... OK"

status="$(vault_get sys/seal-status 2>/dev/null)" || { echo "step: vault reachable ... FAILED" >&2; exit 1; }
if [[ "$status" == *'"initialized":false'* ]]; then
  echo "step: vault initialised ... FAILED (not initialised; use init-fresh.sh)" >&2; exit 1
fi
if ! is_unsealed "$status"; then
  unseal_from_file && echo "step: unseal ... OK" || { echo "step: unseal ... FAILED" >&2; exit 1; }
fi

generate_root_token && echo "step: generate temporary root token ... OK" \
  || { echo "step: generate temporary root token ... FAILED" >&2; exit 1; }

provision_app_token || exit 1

print_next_step
