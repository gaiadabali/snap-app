#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2059 # "cmd && echo OK || fail": the echo cannot fail; the one printf format is an octal escape we just built
# Shared helpers for the Vault operator scripts (unseal.sh, mint-app-token.sh,
# init-fresh.sh). SOURCED, never run: `. "$(dirname "$0")/lib.sh"`.
#
# THE RULE EVERYTHING HERE FOLLOWS: an unseal share or a Vault token must never
# appear in any process's argv. helios is a shared host and /proc/*/cmdline is
# world-readable, so `wget --post-data='{"key":"..."}'` (the way the README used
# to show it) would publish the share to every user on the box for as long as
# the command ran. So:
#   - shares travel over STDIN only: the host shell builds the JSON with printf
#     (a bash BUILTIN, so it never becomes an argv) and pipes it into
#     `docker exec -i ... wget --post-file=/dev/stdin`;
#   - tokens travel as an ENVIRONMENT variable to the `vault` CLI in the
#     container (`docker exec -e VAULT_TOKEN`, with no value on the command
#     line, so docker copies it from its own environment). /proc/PID/environ is
#     readable by the owning user only, unlike cmdline;
#   - nothing here ever echoes a share, a token or a Vault JSON response.
# Verified with a parallel `ps` watcher while the scripts ran; see the commit.

# An explicit PATH, because cron and systemd timers do not give a usable one
# (Ubuntu cron takes PATH from PAM and this host's /etc/environment holds only
# LC_ALL; offsite.sh died from exactly that: `exec: "ssh": not found in $PATH`).
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Every path and name is overridable so the scripts can be tested against a
# throwaway Vault on a laptop. The defaults are helios.
VAULT_CONTAINER="${VAULT_CONTAINER:-snap-apps-vault-1}"
SECRETS_DIR="${SECRETS_DIR:-/etc/snap-apps/secrets}"
SHARES_FILE="${SHARES_FILE:-${SECRETS_DIR}/vault-unseal}"
SHARE3_FILE="${SHARE3_FILE:-${SECRETS_DIR}/vault-share-3-TAKE-OFF-BOX}"
APP_ENV_FILE="${APP_ENV_FILE:-/opt/snap-apps/deploy/.env}"
VAULT_ADDR_IN_CONTAINER="${VAULT_ADDR_IN_CONTAINER:-http://127.0.0.1:8200}"
TRANSIT_KEY="${TRANSIT_KEY:-snap-dek}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Is the container up? A deploy may be recreating it, which is not an error.
vault_container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$VAULT_CONTAINER" 2>/dev/null)" == "true" ]]
}

# GET <path under /v1/>. No secret in it, so plain argv is fine.
vault_get() {
  docker exec "$VAULT_CONTAINER" wget -qO- "${VAULT_ADDR_IN_CONTAINER}/v1/$1"
}

# POST <path under /v1/>, JSON body read from OUR stdin (the share never touches
# argv). Pass an empty body with `</dev/null`; busybox wget then posts nothing.
# NO token here: this is only for the endpoints that need none (init, unseal,
# generate-root).
vault_post_stdin() {
  docker exec -i "$VAULT_CONTAINER" wget -qO- --post-file=/dev/stdin \
    "${VAULT_ADDR_IN_CONTAINER}/v1/$1"
}

# The vault CLI in the container, authenticated by ROOT_TOK (a shell variable of
# THIS script, never exported, never in an argv). VAULT_TOKEN reaches the
# container as an environment variable only.
vcli() {
  VAULT_TOKEN="$ROOT_TOK" docker exec -e VAULT_TOKEN -e "VAULT_ADDR=${VAULT_ADDR_IN_CONTAINER}" \
    "$VAULT_CONTAINER" vault "$@" </dev/null
}
# Same, but forwards OUR stdin (for `vault policy write NAME -`).
vcli_stdin() {
  VAULT_TOKEN="$ROOT_TOK" docker exec -i -e VAULT_TOKEN -e "VAULT_ADDR=${VAULT_ADDR_IN_CONTAINER}" \
    "$VAULT_CONTAINER" vault "$@"
}

# Refuse a shares file that anyone but root could read. The whole point of the
# design is "root on this box holds the key"; a group- or world-readable file
# would quietly widen that to every account. UNSEAL_ALLOW_ANY_OWNER=1 skips the
# check and exists ONLY so the scripts can be tested on a laptop as a non-root
# user. It must NEVER be set on helios.
check_shares_file() {
  [[ -f "$SHARES_FILE" ]] || { echo "unseal shares file ${SHARES_FILE} is missing" >&2; return 1; }
  if [[ "${UNSEAL_ALLOW_ANY_OWNER:-}" != "1" ]]; then
    local owner mode
    owner="$(stat -c %u "$SHARES_FILE")"
    mode="$(stat -c %a "$SHARES_FILE")"
    [[ "$owner" == "0" ]] || { echo "unseal shares file ${SHARES_FILE} is not owned by root; refusing" >&2; return 1; }
    (( (8#$mode & 8#077) == 0 )) || { echo "unseal shares file ${SHARES_FILE} is group/other-accessible (mode ${mode}); refusing" >&2; return 1; }
  fi
  return 0
}

# Pull `"sealed":false` out of a status response without printing it.
is_unsealed() { [[ "$1" == *'"sealed":false'* ]]; }

# Submit the shares in SHARES_FILE one at a time until Vault reports unsealed.
# Returns 0 if unsealed, 1 otherwise. Prints nothing.
unseal_from_file() {
  local share resp
  # Drop any half-finished earlier attempt so a stale progress count cannot
  # make two good shares look like one.
  printf '{"reset":true}' | vault_post_stdin sys/unseal >/dev/null 2>&1 || true
  while IFS= read -r share || [[ -n "$share" ]]; do
    [[ -n "$share" ]] || continue
    resp="$(printf '{"key":"%s"}' "$share" | vault_post_stdin sys/unseal 2>/dev/null)" || { share=""; return 1; }
    if is_unsealed "$resp"; then share=""; return 0; fi
  done < "$SHARES_FILE"
  return 1
}

# Decode the root token that generate-root returns. The server XORs the token
# with a one-time pad and base64-encodes the result (no padding). The obvious
# route, `vault operator generate-root -decode=<enc> -otp=<otp>`, puts both
# values in a process argv for a moment, and together they ARE the root token.
# So the XOR is done here in bash arithmetic instead: base64 and od receive the
# data on stdin, printf is a builtin, and the result goes to the caller's
# variable by name ($3) rather than stdout.
#   decode_root_token <encoded> <otp> <out-var-name>
decode_root_token() {
  local enc="$1" otp="$2" out="$3" bytes b i ch tok=""
  while (( ${#enc} % 4 )); do enc+="="; done
  mapfile -t bytes < <(printf '%s' "$enc" | base64 -d | od -An -v -tu1 -w1)
  (( ${#bytes[@]} == ${#otp} )) || { echo "root token decode: length mismatch" >&2; return 1; }
  for ((i = 0; i < ${#bytes[@]}; i++)); do
    printf -v ch '%d' "'${otp:i:1}"
    b=$(( bytes[i] ^ ch ))
    printf -v ch "\\$(printf '%03o' "$b")"
    tok+="$ch"
  done
  printf -v "$out" '%s' "$tok"
}

# Mint a root token from the shares in SHARES_FILE, with no human handling it.
# Sets ROOT_TOK. Requires an unsealed Vault.
#   1. start a generate-root attempt (returns a one-time pad and a nonce);
#   2. submit shares (stdin) until it completes and hands back the encoded token;
#   3. decode with the pad, in shell memory only.
generate_root_token() {
  local resp otp nonce share enc="" n=0
  # Cancel a stale attempt (a previous run killed mid-way would block ours).
  docker exec -e "VAULT_ADDR=${VAULT_ADDR_IN_CONTAINER}" "$VAULT_CONTAINER" \
    vault operator generate-root -cancel >/dev/null 2>&1 || true

  resp="$(vault_post_stdin sys/generate-root/attempt </dev/null 2>/dev/null)" || { echo "generate-root: could not start" >&2; return 1; }
  otp="$(printf '%s' "$resp" | sed -n 's/.*"otp":"\([^"]*\)".*/\1/p')"
  nonce="$(printf '%s' "$resp" | sed -n 's/.*"nonce":"\([^"]*\)".*/\1/p')"
  [[ -n "$otp" && -n "$nonce" ]] || { echo "generate-root: unexpected start response" >&2; return 1; }

  while IFS= read -r share || [[ -n "$share" ]]; do
    [[ -n "$share" ]] || continue
    resp="$(printf '{"key":"%s","nonce":"%s"}' "$share" "$nonce" | vault_post_stdin sys/generate-root/update 2>/dev/null)" \
      || { share=""; echo "generate-root: share rejected" >&2; return 1; }
    n=$((n + 1))
    if [[ "$resp" == *'"complete":true'* ]]; then
      enc="$(printf '%s' "$resp" | sed -n 's/.*"encoded_token":"\([^"]*\)".*/\1/p')"
      break
    fi
  done < "$SHARES_FILE"
  share=""
  [[ -n "$enc" ]] || { echo "generate-root: did not complete after ${n} share(s)" >&2; return 1; }
  decode_root_token "$enc" "$otp" ROOT_TOK
  enc=""; otp=""; resp=""
}

# Revoke the root token (best effort; used from a trap, so it must not fail).
revoke_root_token() {
  if [[ -n "${ROOT_TOK:-}" ]]; then
    if vcli token revoke -self >/dev/null 2>&1; then
      echo "step: revoke root token ... OK"
    else
      echo "step: revoke root token ... FAILED (revoke it by hand: it is a live root token)" >&2
    fi
    ROOT_TOK=""
  fi
}

# Put the new token into APP_ENV_FILE without it ever being an argv:
#  - back the file up first (mode 600), because a wrong .env stops the stack;
#  - build the new content with bash builtins into a private temp file;
#  - `cat tmp > file` rewrites the existing inode, so owner and mode survive.
write_token_to_env() {
  local new="$1" stamp bak tmp line seen=0
  [[ -f "$APP_ENV_FILE" ]] || { echo "${APP_ENV_FILE} not found" >&2; return 1; }
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  bak="${APP_ENV_FILE}.bak-${stamp}-vault-token"
  ( umask 077; cp -- "$APP_ENV_FILE" "$bak" ) && chmod 600 "$bak"
  tmp="$(umask 077; mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == VAULT_TOKEN=* ]]; then
      printf 'VAULT_TOKEN=%s\n' "$new"; seen=1
    else
      printf '%s\n' "$line"
    fi
  done < "$APP_ENV_FILE" > "$tmp"
  (( seen )) || printf 'VAULT_TOKEN=%s\n' "$new" >> "$tmp"
  cat "$tmp" > "$APP_ENV_FILE"
  rm -f "$tmp"
  echo "    (previous .env kept as ${bak})"
}

# Everything that needs the root token (ROOT_TOK set). Prints step names only.
#   transit mount + key  — created if missing (a fresh init has neither);
#   policy snap-app      — written every time, identical to deploy/vault/README.md;
#   orphan periodic token — create-ORPHAN: a child of the root token would be
#                          revoked together with it (helios, 2026-10-02);
#   .env                 — the new token replaces VAULT_TOKEN.
provision_app_token() {
  local newtok

  if vcli secrets list 2>/dev/null | grep -q '^transit/'; then
    echo "step: transit mount ... OK (already there)"
  else
    vcli secrets enable transit >/dev/null 2>&1 && echo "step: transit mount ... OK (created)" \
      || { echo "step: transit mount ... FAILED" >&2; return 1; }
  fi

  if vcli read "transit/keys/${TRANSIT_KEY}" >/dev/null 2>&1; then
    echo "step: transit key ${TRANSIT_KEY} ... OK (already there)"
  else
    vcli write -f "transit/keys/${TRANSIT_KEY}" >/dev/null 2>&1 && echo "step: transit key ${TRANSIT_KEY} ... OK (created)" \
      || { echo "step: transit key ${TRANSIT_KEY} ... FAILED" >&2; return 1; }
  fi

  # The two operations the KmsProvider makes, plus renewing its own token.
  vcli_stdin policy write snap-app - >/dev/null 2>&1 <<POLICY && echo "step: policy snap-app ... OK" || { echo "step: policy snap-app ... FAILED" >&2; return 1; }
path "transit/encrypt/${TRANSIT_KEY}" { capabilities = ["update"] }
path "transit/decrypt/${TRANSIT_KEY}" { capabilities = ["update"] }
path "auth/token/renew-self" { capabilities = ["update"] }
POLICY

  newtok="$(vcli write -field=token auth/token/create-orphan policies=snap-app period=72h 2>/dev/null)" \
    && [[ -n "$newtok" ]] && echo "step: create app token (orphan, periodic 72h) ... OK" \
    || { echo "step: create app token ... FAILED" >&2; return 1; }

  write_token_to_env "$newtok" && echo "step: write VAULT_TOKEN to .env ... OK" \
    || { echo "step: write VAULT_TOKEN to .env ... FAILED" >&2; newtok=""; return 1; }
  newtok=""
  return 0
}

# What to do next. The compose command is the repo's documented non-bare form
# (docs/DEPLOY.md, "Never run a bare docker compose up"): a bare one would try
# to BUILD docai from source and has filled the disk before.
print_next_step() {
  cat <<'NEXT'
next: the app containers read VAULT_TOKEN at start, so recreate api + worker
      (this script does not restart anything). On helios, from /opt/snap-apps:
        DOCAI_IMAGE=ghcr.io/gaiadabali/snap-docai IMAGE_TAG=sha-<deployed> \
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
          up -d --no-deps --pull never --no-build --force-recreate api worker
      (or run deploy/deploy.sh, which derives those values itself)
NEXT
}
