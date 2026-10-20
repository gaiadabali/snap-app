#!/usr/bin/env bash
# Snap Apps — alert wrapper. Runs uptime.sh (and, on the HOST, the in-box
# checks below), and tells people ONCE when a check flips from OK to FAILING
# (and once more when it flips back), so a 6-hour outage sends one alert, not 72.
#
# Channels (either, both, or neither; neither just logs):
#   EMAIL    ALERT_EMAIL_TO is a comma-separated list of recipients. It is read
#            from the environment, else from /etc/snap-apps/secrets/alert.env
#            (ALERT_ENV_FILE overrides; chmod 600; one line: ALERT_EMAIL_TO=a@x,b@y).
#            SMTP_URL (smtp://user:pass@host:587, STARTTLS) and MAIL_FROM are read
#            from the environment, else from /opt/snap-apps/deploy/.env
#            (SNAP_DEPLOY_ENV overrides): the same account the API sends magic
#            links through. Those files are never sourced; only these keys are
#            read, as text. The SMTP login reaches curl on STDIN (curl -K -), so
#            it is never in argv, in `ps` or in the log.
#   WEBHOOK  ALERT_WEBHOOK_URL: one HTTPS POST endpoint (Slack incoming
#            webhook, Discord webhook). Sent on the flip to failing only.
#
# Env:
#   ALERT_STATE_DIR     default /var/lib/snap-monitor — where last state lives.
#
# Modes:
#   alert.sh --inbox        the host's cron run (adds the in-box checks)
#   alert.sh --test-alert   send ONE clearly labelled test email through the same
#                           path and exit; runs no checks and leaves state alone
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
# Install (helios root cron):    */10 * * * * bash /opt/snap-apps/deploy/monitor/alert.sh --inbox >> /var/log/snap-monitor.log 2>&1
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"

# ── Email channel ────────────────────────────────────────────────────────────
read_key() { # read_key <file> <KEY>: the value of KEY= in an env file, as text; never sourced
  [ -r "$1" ] || return 0
  local v
  v=$(grep -m1 -E "^(export[[:space:]]+)?$2=" "$1" 2>/dev/null | sed -E "s/^(export[[:space:]]+)?$2=//") || true
  v=${v%$'\r'}
  case $v in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

urldecode() { printf '%b' "${1//%/\\x}"; }
cfg_quote() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; } # for a curl -K config string

# send_email <subject> <body>
#   returns 0 sent, 1 failed (a warning line was printed), 3 not configured (silent).
send_email() {
  local subject=$1 body=$2
  local envf="${ALERT_ENV_FILE:-/etc/snap-apps/secrets/alert.env}"
  local deployenv="${SNAP_DEPLOY_ENV:-/opt/snap-apps/deploy/.env}"
  local to=${ALERT_EMAIL_TO:-} url=${SMTP_URL:-} from=${MAIL_FROM:-}
  [ -n "$to" ] || to=$(read_key "$envf" ALERT_EMAIL_TO)
  [ -n "$to" ] || return 3
  [ -n "$url" ] || url=$(read_key "$deployenv" SMTP_URL)
  [ -n "$from" ] || from=$(read_key "$deployenv" MAIL_FROM)
  from=${from:-Snap Apps <no-reply@snap-apps.gaiada.com>}

  case $url in
    smtp://*|smtps://*) ;;
    *) echo "warning: alert email not sent: SMTP_URL is missing or not smtp(s)://"; return 1 ;;
  esac
  local scheme=${url%%://*} rest=${url#*://} cred="" hostport user="" pass="" host port
  rest=${rest%%/*}
  case $rest in *@*) cred=${rest%@*}; hostport=${rest##*@} ;; *) hostport=$rest ;; esac
  case $cred in *:*) user=${cred%%:*}; pass=${cred#*:} ;; *) user=$cred ;; esac
  user=$(urldecode "$user"); pass=$(urldecode "$pass")
  host=${hostport%%:*}
  case $hostport in
    *:*) port=${hostport##*:} ;;
    *) if [ "$scheme" = smtps ]; then port=465; else port=587; fi ;;
  esac
  [ -n "$host" ] || { echo "warning: alert email not sent: no host in SMTP_URL"; return 1; }

  local addr=$from
  case $from in *"<"*">"*) addr=${from#*<}; addr=${addr%%>*} ;; esac

  local rcpts=() parts=() r
  IFS=',' read -r -a parts <<< "$to"
  for r in "${parts[@]}"; do
    r=${r//[$' \t\r\n']/}
    if [ -n "$r" ]; then rcpts+=(--mail-rcpt "$r"); fi
  done
  [ "${#rcpts[@]}" -gt 0 ] || return 3

  local msg
  msg=$(mktemp) || { echo "warning: alert email not sent: mktemp failed"; return 1; }
  local subj to_hdr
  subj=$(printf '%s' "$subject" | LC_ALL=C tr -cd ' -~' | cut -c1-150)
  to_hdr=$(printf '%s' "$to" | tr -d ' \r\n')
  {
    printf 'From: %s\r\n' "$from"
    printf 'To: %s\r\n' "$to_hdr"
    printf 'Subject: %s\r\n' "$subj"
    printf 'Date: %s\r\n' "$(date -u -R)"
    printf 'MIME-Version: 1.0\r\n'
    printf 'Content-Type: text/plain; charset=UTF-8\r\n'
    printf 'Content-Transfer-Encoding: base64\r\n\r\n'
    printf '%s\n' "$body" | base64 | tr -d '\n' | fold -w 76 | sed 's/$/\r/'
  } > "$msg"

  local err rc
  # The login goes in on stdin as a curl config; argv carries no secret.
  err=$(printf 'user = "%s:%s"\n' "$(cfg_quote "$user")" "$(cfg_quote "$pass")" | curl --silent --show-error \
    --ssl-reqd --max-time 30 --url "$scheme://$host:$port" \
    --mail-from "$addr" "${rcpts[@]}" -T "$msg" -K - 2>&1 >/dev/null)
  rc=$?
  rm -f "$msg"
  if [ $rc -ne 0 ]; then
    echo "warning: alert email not sent (curl exit $rc): $(printf '%s' "$err" | head -n 1 | cut -c1-200)"
    return 1
  fi
  return 0
}

host_name="$(hostname 2>/dev/null || echo unknown-host)"
utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# --test-alert: prove delivery. Same path as a real alert; no checks, no state.
if [ "${1:-}" = "--test-alert" ]; then
  send_email "[snap-apps TEST] alert email delivery check" \
"This is a TEST from deploy/monitor/alert.sh --test-alert. Nothing is wrong.
If you can read this, alert emails from this host reach you.

Host: $host_name
Time: $(utc_now)"
  rc=$?
  case $rc in
    0) echo "test alert email sent"; exit 0 ;;
    3) echo "ERROR: no recipients: set ALERT_EMAIL_TO (environment, or ${ALERT_ENV_FILE:-/etc/snap-apps/secrets/alert.env})"; exit 1 ;;
    *) echo "ERROR: the test alert email could not be sent (see the warning above)"; exit 1 ;;
  esac
fi

ALERT_STATE_DIR="${ALERT_STATE_DIR:-/var/lib/snap-monitor}"
mkdir -p "$ALERT_STATE_DIR"
fail=0
summary=""
failing_lines=""
ok_lines=""

record() { # record <FAILED|OK> <line>
  summary="$summary$2"$'\n'
  if [ "$1" = FAILED ]; then fail=1; failing_lines="$failing_lines$2"$'\n'; else ok_lines="$ok_lines$2"$'\n'; fi
}

# ── External checks (uptime.sh) unless --inbox-only ──────────────────────────
if ! uptime_out=$("$HERE/uptime.sh" 2>&1); then
  fail=1
fi
summary="$summary$uptime_out"$'\n'
while IFS= read -r l; do
  [ -z "$l" ] && continue
  case $l in FAILED*) failing_lines="$failing_lines$l"$'\n' ;; *) ok_lines="$ok_lines$l"$'\n' ;; esac
done <<< "$uptime_out"

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
# One message on the flip to failing, one on the flip back. A failed send is a
# warning line in the log; it never changes the exit code or the state.
mail_body() { # mail_body <headline>
  printf '%s\n\nFAILING:\n%s\nOK:\n%s\nHost: %s\nTime: %s\n' \
    "$1" "${failing_lines:-(none)$'\n'}" "${ok_lines:-(none)$'\n'}" "$host_name" "$(utc_now)"
}
state_file="$ALERT_STATE_DIR/last-state"
prev=$(cat "$state_file" 2>/dev/null || echo ok)
if [ $fail -eq 1 ]; then
  echo failing > "$state_file"
  if [ "$prev" != "failing" ]; then
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      curl -fsS -X POST -H 'Content-Type: application/json' \
        -d "$(printf '{"text":"snap-apps ALERT\\n%s"}' "$summary")" \
        "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || echo "warning: could not post alert webhook"
    fi
    first=$(printf '%s' "$failing_lines" | head -n 1)
    send_email "[snap-apps ALERT] ${first:-a check is failing}" "$(mail_body "A check started failing.")" || true
  fi
  echo "$summary"
  exit 1
fi
echo ok > "$state_file"
if [ "$prev" = "failing" ]; then
  send_email "[snap-apps RECOVERED] all checks OK" "$(mail_body "Every check is OK again.")" || true
fi
echo "$summary"
