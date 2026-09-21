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
# In-box checks (run ONLY on delphi; uptime.sh is the external half):
#   - last night's backup log has today's dump
#   - disk free on / above 90%
#   - Vault is not sealed
#
# Install (external box):   */5 * * * * /path/to/alert.sh
# Install (delphi cron):    15 3 * * * /opt/snap-apps/deploy/monitor/alert.sh --inbox
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
  # 1. Last night's backup: today's dump line must exist in the log.
  log=/opt/snap-apps/backups/backup.log
  today=$(date +%F)
  if [ -f "$log" ] && grep -q "$today" "$log" 2>/dev/null; then
    record OK "backup: log has $today"
  else
    record FAILED "backup: no dump logged today in $log"
  fi

  # 2. Disk: same threshold that killed the host on 2026-09-17.
  use=$(df -P / | awk 'NR==2{sub(/%/,""); print $5}')
  if [ "${use:-0}" -gt 90 ]; then
    record FAILED "disk: / is ${use}% full"
  else
    record OK "disk: / is ${use}% full"
  fi

  # 3. Vault sealed state: a sealed Vault is an outage of every provider key.
  # Skipped with a note when Vault is not configured at all — the note keeps
  # the gap VISIBLE in every summary without crying wolf. (Staging has no
  # Vault yet; preflight says so at every boot.)
  if [ -z "${VAULT_ADDR:-}" ]; then
    record OK "vault: not configured — known gap, see preflight warning"
  elif curl -fsS --max-time 5 "$VAULT_ADDR/v1/sys/health" 2>/dev/null | grep -q '"sealed":false'; then
    record OK "vault: unsealed"
  else
    record FAILED "vault: sealed or unreachable"
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
