#!/usr/bin/env bash
# Snap Apps — alert wrapper. Runs uptime.sh (and, on the HOST, the in-box
# checks below), and posts one Telegram/Slack/Discord webhook message when a
# check flips from OK to FAILING, so a 6-hour outage sends one alert, not 72.
#
# Env:
#   ALERT_WEBHOOK_URL   required — one HTTPS POST endpoint (Telegram bot API,
#                       Slack incoming webhook, Discord webhook). No SDK.
#   ALERT_STATE_DIR     default /var/lib/snap-monitor — where last state lives.
#
# In-box checks (run ONLY on the host — helios; uptime.sh is the external half):
#   - the newest nightly dump is under 26 hours old
#   - the last offsite run succeeded under 26 hours ago
#   - the newest weekly base backup is under 8 days old
#   - disk free on / above 90%
#   - Vault is not sealed
#   - Vault's app token was renewed under 13 hours ago
#
# In-box path overrides (defaults are helios; they exist so the checks can be
# exercised against a scratch tree): BACKUP_DUMP_DIR, BACKUP_BASE_DIR,
# OFFSITE_STAMP, VAULT_RENEW_LOG, SNAP_VAULT_CONTAINER.
#
# Install (external box):   */5 * * * * /path/to/alert.sh
# Install (helios root cron):    15 3 * * * /opt/snap-apps/deploy/monitor/alert.sh --inbox
set -u

ALERT_STATE_DIR="${ALERT_STATE_DIR:-/var/lib/snap-monitor}"
mkdir -p "$ALERT_STATE_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0
summary=""

record() { # record <FAILED|OK> <line>
  if [ "$1" = FAILED ]; then fail=1; summary="$summary$2"$'\n'; else summary="$summary$2"$'\n'; fi
}

# ── External checks (uptime.sh) unless --inbox-only ──────────────────────────
if ! uptime_out=$("$HERE/uptime.sh" 2>&1); then
  fail=1
fi
summary="$summary$uptime_out"$'\n'

# ── In-box checks: only when running ON the host (with --inbox or by default
#    if the state dir already says we are host-side). Keep them cheap.
if [ "${1:-}" = "--inbox" ]; then
  # Age helpers for the freshness checks. Both read only file metadata or one
  # log line: no restic, no network, no docker — this runs every 10 minutes.
  now=$(date +%s)
  newest_file() { # newest_file <dir> <glob>  -> "<epoch> <path>" of the newest match, or nothing
    find "$1" -maxdepth 1 -type f -name "$2" -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | head -n 1 | sed 's/^\([0-9]*\)\.[0-9]* /\1 /'
  }

  # 1. Last night's dump is FRESH: the newest snapapps-*.dump.gz is under 26 h
  # old. backup.sh runs at 03:15 UTC, so 26 h = one full cycle plus slack. This
  # replaces a grep of backup.log for today's date that never matched (the log
  # stamps look like 20261020T031501Z, not 2026-10-20) and would have been wrong
  # between 00:00 and 03:15 anyway. Catches: backup cron dead, dump step failing,
  # disk full, backups dir unmounted.
  dump_dir="${BACKUP_DUMP_DIR:-/opt/snap-apps/backups/postgres}"
  newest=$(newest_file "$dump_dir" 'snapapps-*.dump.gz')
  if [ -z "$newest" ]; then
    record FAILED "backup: no snapapps-*.dump.gz in $dump_dir"
  else
    age_h=$(( (now - ${newest%% *}) / 3600 ))
    if [ $(( now - ${newest%% *} )) -lt $(( 26 * 3600 )) ]; then
      record OK "backup: newest dump is ${age_h}h old"
    else
      record FAILED "backup: newest dump is ${age_h}h old (limit 26h): ${newest#* }"
    fi
  fi

  # 1b. Offsite copy is FRESH: offsite.sh writes this stamp as its very last
  # step (after `restic forget` succeeds), so a stale or missing stamp means the
  # 04:00 run died anywhere on the way. Catches: restic/ssh failures, a wrong
  # password, an unreachable repo. We read the stamp's mtime only — never restic.
  stamp="${OFFSITE_STAMP:-/opt/snap-apps/backups/.offsite-last-ok}"
  if [ ! -f "$stamp" ]; then
    record FAILED "offsite: no successful offsite run recorded yet ($stamp missing)"
  else
    mt=$(stat -c %Y "$stamp")
    age_h=$(( (now - mt) / 3600 ))
    if [ $(( now - mt )) -lt $(( 26 * 3600 )) ]; then
      record OK "offsite: last successful run ${age_h}h ago"
    else
      record FAILED "offsite: last successful run ${age_h}h ago (limit 26h)"
    fi
  fi

  # 1c. Weekly base backup is FRESH: the newest base-*.tar.gz is under 8 days
  # old (Sunday schedule plus a day of slack). Catches: the Sunday pg_basebackup
  # step failing while the nightly dumps keep succeeding, which would quietly
  # end point-in-time recovery.
  base_dir="${BACKUP_BASE_DIR:-/opt/snap-apps/backups/basebackups}"
  newest=$(newest_file "$base_dir" 'base-*.tar.gz')
  if [ -z "$newest" ]; then
    record FAILED "base backup: no base-*.tar.gz in $base_dir"
  else
    age_s=$(( now - ${newest%% *} ))
    if [ "$age_s" -lt $(( 8 * 86400 )) ]; then
      record OK "base backup: newest is $(( age_s / 86400 ))d old"
    else
      record FAILED "base backup: newest is $(( age_s / 86400 ))d old (limit 8d): ${newest#* }"
    fi
  fi

  # 2. Disk: same threshold that killed the host on 2026-09-17.
  use=$(df -P / | awk 'NR==2{sub(/%/,""); print $5}')
  if [ "${use:-0}" -gt 90 ]; then
    record FAILED "disk: / is ${use}% full"
  else
    record OK "disk: / is ${use}% full"
  fi

  # 3. Vault sealed state: a sealed Vault is an outage of every provider key.
  # Vault publishes no port, and $VAULT_ADDR (http://vault:8200) only resolves
  # inside the compose network, so from the host's cron we ask the container.
  # Skipped with a note when there is no Vault at all — the note keeps the gap
  # VISIBLE in every summary without crying wolf.
  vault_ctr="${SNAP_VAULT_CONTAINER:-snap-apps-vault-1}"
  if docker inspect "$vault_ctr" >/dev/null 2>&1; then
    if docker exec "$vault_ctr" wget -qO- http://127.0.0.1:8200/v1/sys/health 2>/dev/null | grep -q '"sealed":false'; then
      record OK "vault: unsealed"
    else
      record FAILED "vault: sealed, uninitialised or unreachable — unseal per deploy/vault/README.md"
    fi

    # 3b. App token renewal: renew-token.sh runs every 12 h and logs one line
    # per attempt, so the LAST line must say "renewed" and be under 13 h old.
    # Catches: the renew timer dead, or the token expiring unrenewed — which
    # takes every provider key down at once even though Vault is unsealed. Only
    # checked where a Vault container exists, like the check above.
    rlog="${VAULT_RENEW_LOG:-/var/log/snap-vault-renew.log}"
    if [ ! -f "$rlog" ]; then
      record FAILED "vault token: renewal log $rlog missing — renew-token.sh has never run"
    else
      last=$(tail -n 1 "$rlog")
      ts=$(printf '%s' "$last" | sed -n 's/^\[\([^]]*\)\].*/\1/p')
      # An empty $ts must not reach date: GNU date reads "" as midnight today.
      ts_epoch=""
      [ -n "$ts" ] && ts_epoch=$(date -u -d "$ts" +%s 2>/dev/null || true)
      if [ -z "$ts_epoch" ]; then
        record FAILED "vault token: cannot read a timestamp from the last line of $rlog: $last"
      elif ! printf '%s' "$last" | grep -q 'renewed' || printf '%s' "$last" | grep -q 'FAILED'; then
        record FAILED "vault token: last renewal attempt did not succeed: $last"
      elif [ $(( now - ts_epoch )) -ge $(( 13 * 3600 )) ]; then
        record FAILED "vault token: last renewal was $(( (now - ts_epoch) / 3600 ))h ago (limit 13h)"
      else
        record OK "vault token: renewed $(( (now - ts_epoch) / 3600 ))h ago"
      fi
    fi
  elif [ -n "${VAULT_ADDR:-}" ]; then
    if curl -fsS --max-time 5 "$VAULT_ADDR/v1/sys/health" 2>/dev/null | grep -q '"sealed":false'; then
      record OK "vault: unsealed"
    else
      record FAILED "vault: sealed or unreachable"
    fi
  else
    record OK "vault: not configured — known gap, see preflight warning"
  fi
fi

# ── De-duplicated notification: only on a transition. ────────────────────────
state_file="$ALERT_STATE_DIR/last-state"
prev=$(cat "$state_file" 2>/dev/null || echo ok)
if [ $fail -eq 1 ]; then
  echo failing > "$state_file"
  if [ "$prev" != "failing" ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "$(printf '{"text":"snap-apps ALERT\\n%s"}' "$summary")" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || echo "warning: could not post alert webhook"
  fi
  echo "$summary"
  exit 1
fi
echo ok > "$state_file"
echo "$summary"
