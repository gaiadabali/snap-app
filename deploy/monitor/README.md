# deploy/monitor — the eyes the box does not have

Before 2026-09-21 nothing outside the box watched anything: a wedged deploy,
a downed container, a sealed Vault, or a backup that silently stopped was
discoverable only by a human SSHing in (docs/DEPLOY.md §10.1 said as much).
These two scripts close that, in two halves:

- **`uptime.sh`** — EXTERNAL checks, run from anywhere that is NOT delphi:
  the three public endpoints, `/v1/ready` asserting `rlsEnforced:true` (the
  same gate deploy.sh refuses on), and TLS expiry inside 14 days.
- **`alert.sh`** — runs `uptime.sh`, adds the in-box checks only a host can do
  (backup logged today, disk under 90%, Vault unsealed), and posts ONE
  webhook message on a transition from OK to failing, so a 6-hour outage
  sends one alert, not one every 5 minutes.

## Install

1. **External (required):** on any second machine or a cron runner:

   ```cron
   */5 * * * * ALERT_WEBHOOK_URL=<webhook url> /path/to/alert.sh >> /var/log/snap-monitor.log 2>&1
   ```

   The webhook is a plain HTTPS POST with `{"text": ...}` — it works with
   Telegram (`https://api.telegram.org/bot<token>/sendMessage` needs a small
   `chat_id` wrapper — use a Slack/Discord incoming webhook for zero work).
   Store the URL in the cron line's environment or a chmod-600 file you
   source; never commit it.

2. **On delphi (the in-box half):**

   ```cron
   */10 * * * * VAULT_ADDR=http://127.0.0.1:<vault port> /opt/snap-apps/deploy/monitor/alert.sh --inbox >> /var/log/snap-monitor.log 2>&1
   ```

3. Verify: run `./uptime.sh` by hand — expected output ends with exit 0 and
   no `FAILED` lines while staging is healthy. Break one URL in a copy and
   confirm exit 1 plus a `FAILED` line before trusting it.

## The checks and why each one exists

| Check | Why |
|---|---|
| `/v1/ready` rlsEnforced | deploy.sh already refuses to roll out without it; if it goes false in production the site is serving data it must not. |
| TLS expiry ≤ 14 days | renewal is CloudPanel-manual; nothing in-repo renews it. |
| Backup logged today | `backup.sh` is a bare cron that can fail silently; the 2026-09-17 disk incident showed what an unwatched box costs. |
| Disk ≤ 90% on `/` | the same incident: the disk filled to 100% and took co-hosted sites down. |
| Vault unsealed | a restarted Vault comes back SEALED and nothing unseals it (deploy/vault/README.md) — every provider key fails until a human with two Shamir shares acts. |

## Restore drill log

- 2026-09-21: **DRILL PASSED** — dump `snapapps-20260921T081554Z.dump.gz`
  (the first backup ever taken on delphi; the bootstrap cron that would have
  installed backup.sh was deliberately skipped on this box, so nothing before
  this date is recoverable) restored into throwaway `snapapps_restore_test`:
  64 public tables, `transaction_splits` restored=0 == live=0 (staging holds
  no transactions yet), exit 0. The drill's proof compares restored rows
  against the live count, not against a hardcoded non-zero.
- WAL archiving also live since 2026-09-21: `archive_mode=on`, `wal_level=replica`,
  `pg_stat_archiver` archived_count climbing. PITR = weekly `pg_basebackup`
  (Sundays, in backup.sh) + this archive.
