#!/usr/bin/env bash
# Unseals Vault if (and only if) it is sealed. Run every minute by the systemd
# timer snap-vault-unseal.timer, and by hand: deploy/vault/unseal.sh
#
# WHY THIS EXISTS: owner decision 2026-10-20, replacing the manual Shamir unseal
# of 2026-09-21. A Vault that comes back sealed after every host reboot or
# deploy took every KMS-backed feature down until somebody noticed. Two of the
# three shares now live on this box in a root-only file; the third stays with
# the owner. The cost, stated plainly in deploy/vault/README.md: root on this
# host (or a copy of its disk) now holds both the locked data and the key.
#
# Quiet by design: it runs every minute, so the normal outcomes (Vault already
# unsealed, container being recreated) print NOTHING. One line is printed when
# it actually unseals, and one line on any failure, with exit status 1.
#
# A share never appears in argv, output or logs (see lib.sh for how).
#
# Environment (defaults are helios):
#   VAULT_CONTAINER=snap-apps-vault-1
#   SHARES_FILE=/etc/snap-apps/secrets/vault-unseal   one base64 share per line, root:root 600
#   UNSEAL_ALLOW_ANY_OWNER=1   skips the owner/mode check. For laptop tests ONLY;
#                              never set it on helios.
# shellcheck disable=SC2015  # "cmd && echo OK || fail": the echo cannot fail
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${HERE}/lib.sh"

# A deploy may be recreating the container right now. Not an error.
vault_container_running || exit 0

status="$(vault_get sys/seal-status 2>/dev/null)" || { echo "[$(ts)] vault unreachable (container up, API not answering)" >&2; exit 1; }

if is_unsealed "$status"; then
  exit 0
fi
if [[ "$status" == *'"initialized":false'* ]]; then
  echo "[$(ts)] vault is not initialised; nothing to unseal (see deploy/vault/README.md)" >&2
  exit 1
fi

check_shares_file || exit 1

if unseal_from_file; then
  echo "[$(ts)] vault was sealed; unsealed"
else
  echo "[$(ts)] vault is sealed and the shares in ${SHARES_FILE} did not unseal it" >&2
  exit 1
fi
