# Plan: Snap Apps Production-Readiness Remediation (all 24 audit items, 4 stages)

## Goal

Close the 24 gaps found by the 2026-09-21 production-readiness audit (`C:\Users\Hansel\workspace\snap-apps\2026-09-21-production-readiness-audit.md`) so snap-apps is safe for real external users and production financial records, in 4 stages: survivability → AI gate → real users → compliance.

## Progress log

- **2026-09-21 (commit `e261fc9`, landed by the Hermes subagent): Task 7 (item 1) COMPLETE — grounding is now a review gate, not a note.**
  - **The audit item is closed by test.** `grounding-gate.test.ts` (4 tests, all pure — no DB, no model): a clean extraction with `payableAmount` confidence 0.99 but a stored grounding report saying NO span supports the total is forced to `needs_review`; a capture with NO grounding report at all is also `needs_review` (fail-closed); a fully-grounded report still auto-accepts; and a report measured against a DIFFERENT value (a previous attempt's output) does not cover the new run. Before this, `validate()` alone auto-accepted the 0.99-ungrounded case — the test pins that old verdict first, then proves the gate changes it.
  - **Mechanism:** `run.ts` gains `applyGroundingGate()`, applied to `validate()`'s verdict inside `runExtraction` via a new optional `grounding` param — the STORED report is READ (never re-run; `shadow.ts` stays the only writer, and `runExtraction` stays pure). `worker.ts` reads the rows with the new `repo.ts#groundingForCapture` before the model loop and passes them in; a failed read is treated the same as no report. Critical fields are the intersection of `validators.ts`'s `CRITICAL_FIELDS` and `shadow.ts`'s `fieldsToGround`: payableAmount, taxAmount, supplierName, supplierAbn, issueDate. **The plan's `gstAmount`/`taxCode` do not exist in this codebase** — the money field is `taxAmount` and the GST is checked by arithmetic, not by a model-returned code — so the gate covers what actually exists (noted in a comment in `run.ts`).
  - **Honest cost, stated in the worker comment:** on a FIRST extraction there is no grounding report yet, so every fresh capture goes to review; it can only auto-accept on a later run once the shadow stage has measured its pages. That is the fail-closed consequence of not trusting a total the page does not say — the plan's risk section predicted the raised review rate.
  - `shadow.ts`'s lines-268-273 comment block now states the new contract: the full report is still written (no data lost), but `enforced` is "false in name only" — the accept decision consumes the stored rows. Full extraction suite 179/179 green (15 files, real Postgres env per plan); `tsc --noEmit` clean. Committed on `feat/indonesia-tax-rules`, NOT pushed.


- **2026-09-21 (Hermes session): Task 4 COMPLETE. Task 5 built, blocked on credentials. Task 6's remaining check already satisfied. Monitor wired.**
  - **Task 4 (WAL + PITR + restore drill) done and drilled.** `deploy/restore.sh` written; first-ever backup taken on delphi (the bootstrap cron that installs backup.sh was deliberately skipped on this shared box — nothing before 2026-09-21 is recoverable); **restore drill PASSED** (64 tables, splits restored=live, output recorded in deploy/monitor/README.md). backup.sh hardened: temp-then-rename dumps, weekly Sunday `pg_basebackup` for PITR. WAL archiving live: compose gains `wal_archive_data:/wal-archive`; applied to the live DB via ALTER SYSTEM + restart; verified `pg_stat_archiver` archived_count climbing. Pitfall recorded in the compose comment: a fresh named volume is root-owned — archive_command fails silently until `chown 70:70 /wal-archive`.
  - **Monitor wired, two halves.** In-box: root crontab on delphi — backup.sh 03:15 → backup.log, `alert.sh --inbox` every 10 min → /var/log/snap-monitor.log. External: `.github/workflows/monitor.yml` runs `uptime.sh` on GitHub's runners every 15 min; posts `ALERT_WEBHOOK_URL` (repo secret, NOT yet set) on failure and fails the run so watchers see it. alert.sh's Vault check now skips-with-note when Vault is unconfigured (it is not deployed on staging; crying wolf would bury real alerts).
  - **The monitor immediately earned its keep:** first `--inbox` run found (a) backup.log empty (fixed by re-running backup.sh through the cron's redirect) and (b) **disk at 94%** — above the alarm that preceded the 2026-09-17 incident. Breakdown: ~61G is OTHER vhosts' home dirs (u19kobpm 35G, u14gmkqn 7.5G, u25qjdoc 6.7G — not ours to delete), ~4.8G operator leftovers in /root (rhproperty-decommission 3.5G, pre-gaiada-backup 1.3G). snap-apps' own footprint is small; docker prune reclaimed 0B. **Operator decision needed on /root cleanup and the co-tenant data.**
  - **Task 5 (offsite) built, NOT live.** `deploy/offsite.sh` written (restic → B2/S3; pushes dumps + basebackups + storage originals; forget --keep-daily 7 --keep-monthly 12). BLOCKED on the operator choosing/creating an object-store target and providing credentials for `/etc/snap-apps/secrets/restic{,.env}`. NOT wired to cron until a verified run exists (a never-restored offsite copy is not a backup either).
  - **Task 6 (Stripe quarantine) closed:** the merge already landed (Tasks 0-2, commit 81d6a42) and the fatal-on-simulator test already exists (`preflight.test.ts:163` asserts `STRIPE_SIMULATOR=true` fails production preflight). Nothing to add.

- **2026-09-21 (Hermes session, commits `dce47ec` + `ca9e15a`): staging outage found by the monitor, fixed; Task 3 CLOSED.**
  - **The monitor caught a real outage on its first negative-case run.** Running uptime.sh's broken-URL drill (required by Task 3 step 4) returned exit 1 — but so did the HEALTHY run: the staging API had been 502 for an hour. `snap-apps-api-1` was crash-looping with `FST_ERR_CTP_ALREADY_PRESENT` since the `17bfe06` deploy. web, mobile and docai kept serving; only the API was down, and nothing on the box noticed.
  - **Root cause:** the Stripe raw-body work adds a custom `application/json` parser in `main.ts`; Nest's FastifyAdapter then registers its own JSON parser during app init and `addContentTypeParser` throws, so the process refuses to boot. CI was green because **no test boots the real server** — the e2e harness passes raw bodies by hand. Fix in `main.ts`: after registering our parsers, set the adapter's `_isParserRegistered` flag (the adapter's own documented escape hatch for exactly this). Consequence noted in the comment: Nest's urlencoded parser is skipped too — nothing posts forms to this API.
  - **Verified by booting the real server locally** (the check that was missing): preflight ok → "Nest application successfully started" → listening. 61 tests across credits/documents green, typecheck clean.
  - **Deploy verified end to end:** poller rolled `ca9e15a`; `docker ps` shows `sha-ca9e15a Up (healthy)`; `GET /v1/ready` → `ok:true, rlsEnforced:true`. This also closes the open item from `17bfe06`'s entry — CI green + deploy pickup observed (via ssh, not gh).
  - **Task 3 closed:** scripts committed in `ca9e15a` (`deploy/monitor/{uptime,alert}.sh`, README); BOTH halves of step 4 now run — exit 1 with a dead URL, exit 0 healthy (observed live, twice, and it caught a genuine outage in between).
  - **Outstanding:** the monitor is not yet WIRED anywhere — uptime.sh/alert.sh exist but no cron or external runner executes them on a schedule. First item of the next session.

- **2026-09-21 (commit `81d6a42`, landed by the Claude agent): Tasks 0, 1, 2 COMPLETE.** Stripe provider + webhook on main: `apps/server/src/credits/stripe-provider.ts`, `stripe-webhook.controller.ts`, `stripe-simulator.ts` (+ 480 lines of tests); checkout carries `userId`; duplicate VouchersController removed; raw body retained for `/v1/credits/webhooks/` only; fail-closed refusal when STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET; BECS payment_status gating; retry-correct status codes. 726 server tests pass. Task 6's merge decision is moot (already on main) — remaining: verify staging deploy picked it up and the buy flow still answers "unavailable" with no keys configured. **Stage 1 next: Task 3 (monitoring) → Task 4 (WAL/restore drill) → Task 5 (offsite).**

- **2026-09-21 (commit `17bfe06`, pushed to main by the Claude agent): CI unblocked. The reported `***` password corruption was a FALSE ALARM — the real defect was the opposite.**
  - **The masked passwords never reached git.** `***` existed only in the uncommitted working copy of `.github/workflows/ci.yml`. `git show HEAD:.github/workflows/ci.yml` and `origin/main` both already carried the correct values. Nothing masked was ever committed or pushed, so CI was never at risk from it. No secrets were needed from the user to fix this: `app-dev-password` and `verify` are local dev credentials for an ephemeral CI Postgres, already in plaintext on lines 140 and 150 of that same file and in `packages/db/test/require-owner-role.setup.ts:62`. They were restored from the repo and came out byte-identical to the committed version — the two `SNAP_TEST_*` lines do not appear in the final diff at all, which is the proof.
  - **The actual bug: `DATABASE_OWNER_URL` was never set.** Only the COMMENT explaining why it is needed had landed. The file documented a fix that was not there — the same "a written decision is not a shipped one" pattern `docs/GAPS.md` and `docs/DEPLOY.md` §8 both name. That is why CI stayed red on `mail-delivery.db.test.ts`.
  - **Root cause fixed, not just the symptom.** `mail-delivery.db.test.ts` read `process.env.DATABASE_OWNER_URL ?? url!`. That fallback substituted the application connection — the one migration 0034 CORRECTLY forbids from reading `mail_deliveries` — so a missing env var surfaced as `permission denied` and read as "the RLS assertions are broken". Falling back to a connection that cannot do the job can only produce a confusing failure. It now refuses with a sentence naming the variable and where its value comes from.
  - **Verified by running both states against real Postgres:** without the variable, exactly the 5 failures described, now carrying the explicit message; with the literal values from `ci.yml`, all four suites that read these vars pass (20/20 — `mail-delivery.db`, `agreement-report.e2e`, `device-agreement.e2e`, `images.repo`).
  - **CI/deploy outcome NOT yet confirmed.** The `gh run list` check was blocked by a permission classifier in this session, so nobody has watched this commit go green. **Next session must confirm it before treating Stage 1 as unblocked.**

- **2026-09-21 (commit `89b5833`, on main): Task 8 (item 5) COMPLETE.** The worker refuses — job released with backoff, nothing read or saved — when a non-AU workspace has no rule set for its country, when the installed rule set's country mismatches the workspace, or when the tenant does not exist. New suite `apps/server/src/worker/rules-jurisdiction.test.ts` (4/4), plus worker/statement/tax-code-country suites (20/20) and a clean typecheck. *Note for the record: an earlier progress report cited this as `b3a3e97`; that object exists but was superseded. The commit on main is `89b5833`.*

- **2026-09-21: Task 3 (item 6) scripts exist but are UNCOMMITTED and unreviewed.** `deploy/monitor/uptime.sh` (reported verified live against staging, exit 0), `deploy/monitor/alert.sh` (de-duplicated webhook alerts incl. backup/disk/Vault checks) and `deploy/monitor/README.md` are present in the working tree only. They were deliberately NOT swept into `17bfe06`: this is a shared checkout, another agent authored them, and committing another agent's unreviewed files alongside an unrelated fix has gone wrong here before. **Task 3 is not closeable until someone reviews and commits them, and until step 4's negative case is actually run** — the plan requires breaking one URL in a copy and observing exit 1, and only the exit-0 half has been reported. A monitor that has never been seen to fail is not a monitor yet.

- **2026-09-21 ~15:49–15:56 local: STAGING OUTAGE, caused by `81d6a42` (mine), fixed by `dce47ec` + deployed at `ca9e15a`. Root cause and verification recorded here because the commit messages alone do not carry it.**
  - **What happened:** `snap-apps.gaiada.com` and `snap-apps-api.gaiada.com` both 502. `snap-apps-api-1` crash-looping; the 15:49 deploy of `sha-17bfe06` aborted on the failed healthcheck, which left `snap-apps-web-1` stranded in `Created` — so the marketing site went down as collateral, not as a second fault.
  - **Cause:** `FST_ERR_CTP_ALREADY_PRESENT` — the raw-body parser added to `main.ts` for the Stripe webhook claimed `application/json`, and Nest's FastifyAdapter registers its own JSON parser during `listen()`. **726 server tests, 295 db tests and a clean typecheck all passed**, because no test in this repo boots the real server: the e2e suites construct controllers directly and hand them request objects. `dce47ec`'s title states this correctly and it is the durable lesson — treat ANY `main.ts` edit (parser, interceptor, global pipe, boot-time await) as untested by construction.
  - **The fix was reviewed, not just accepted.** `_isParserRegistered = true` is the adapter's own escape hatch, and its side effect of skipping Nest's urlencoded parser is safe here: every `x-www-form-urlencoded` use in this repo is OUTBOUND (`stripe-provider.ts` to Stripe, `apps/web/src/lib/auth/google.ts` to Google). Nothing posts forms to this API. Verified by grep, not assumed.
  - **Recovered and confirmed:** all three hosts 200, `/v1/ready` reports `rlsEnforced: true` / role `snap_app`, all six containers healthy.

- **2026-09-21: verification of the three items previously flagged open — two closed, one not.**
  - ✅ `DATABASE_OWNER_URL`: CI is **green on `17bfe06`**, and `89b5833` immediately before it was **red**, so the fix demonstrably did what it claimed rather than coinciding with a green run.
  - ✅ `deploy/monitor/`: now 3 files tracked in git. `ca9e15a`'s title claims the negative case was run. **Not independently re-verified** — whoever closes Task 3 should confirm the exit-1 path is actually exercised, not just described.
  - ❌ **Vault is still not deployed.** The API boot log confirms `ADMIN_KMS_PROVIDER=vault` with no `VAULT_TOKEN`, so the Lane K preflight warning is firing as designed and credential WRITES remain refused. Task 22 is still open; `deploy/vault/README.md` has the key ceremony.

- **2026-09-21: TWO ITEMS HANDED TO HERMES by the owner's decision. Both are mine; neither is urgent; both are real.**
  - **H1 — the JSON body limit silently dropped from 32 MB to 1 MB, globally.** `main.ts`'s raw-body parser sets `{ parseAs: 'string', bodyLimit: 1024 * 1024 }`. That was meant to bound the *webhook*, but with Nest's parser now skipped (`_isParserRegistered`), this parser handles **every** JSON request, so the cap applies to all of them — against an adapter `bodyLimit` of 32 MB elsewhere in the same file. Nothing breaks today (a real device DocDOM layout is ~20–31 KB, checked against `apps/server/bench/corpus/device/mlkit/galaxy-a71-8gb/*.json`), so this is a latent 413 on the largest JSON path rather than a live fault. *Do:* raise the parser's limit to the adapter's 32 MB and, if the webhook specifically should be bounded, bound it at the route rather than at the content type. *Done when:* a test posts a >1 MB JSON body to a normal endpoint and it is accepted. **Note the trap:** no existing test would catch a regression here either, for the same reason the outage above shipped — this needs a real boot or a route-level assertion.
  - **H2 — `poll-deploy.sh` writes the live database password into journald.** Every deploy logs `DATABASE_URL=postgres://snap_app:<real password>@...` and the same for `snap_worker`, in plaintext, to the systemd journal on delphi — visible to anything that can read the journal and retained by its rotation policy. Pre-existing and unrelated to the Stripe work; found while reading `journalctl -u snap-deploy.service` during the outage. *Do:* stop echoing `db.mjs`'s output, or filter the URL lines before they reach stdout. *Done when:* a deploy run produces no password in `journalctl -u snap-deploy.service`. *Then:* rotating that password is a separate act and belongs with **Task 21 (secret rotation)** — the credential should be treated as exposed until it is rotated, not merely un-logged going forward.

## Current context / assumptions

- **Repo:** `C:/Users/Hansel/Documents/Hansel/Projects/snap-apps` (git, commit `0a58cce`, Node ≥ 20, pnpm 11.3).
- **Live:** staging on shared VPS delphi (`72.61.142.88`, `ssh delphi`), containers `snap-apps-{api,web,worker,docai,mobile}-1` + `snap-postgres`, deployed by systemd timer polling GitHub every 5 min. **Never run `deploy/bootstrap.sh` on delphi. Deploy from inside the repo's own pipeline only; deploy.sh with `SKIP_CADDY=1`.**
- The tree has uncommitted work: modified `apps/server/src/credits/payment-provider.ts`, untracked `apps/server/src/credits/stripe-provider.ts` and `apps/server/src/integrations/stripe-simulator.ts`. **First task is to snapshot that work on a branch so it is not lost.**
- Audit rules: read-only audit ran without executing tests. Each remediation task below therefore starts by writing/running a test.
- Verification commands run from repo root unless stated. Run `pnpm install` first if `node_modules` is stale.
- SSH to delphi is allowed for deploy/ops tasks only, using `ssh delphi` (key path `~/.ssh/ssh-key-hansel`, referenced only).
- Suites self-skip without a DB: always run tests with the local Postgres up (`node packages/db/scripts/db.mjs up`) or with `REQUIRE_DB=1` for anything touching the DB suites.

## Architecture / proposed approach

Work lands in 4 sequential stages, one branch per item, merged to main in order — the deploy timer picks up each merged commit automatically, so staging becomes more survivable progressively rather than in one big swap. Code items follow TDD (failing test → minimal fix → green → commit); ops items land as scripts + a drill whose output is the proof. Alerting (item 6) is built early because every later task (backup verification, Vault, TLS, offsite replication) reports into it.

---

## STAGE 1 — Survivability

### Task 0. Snapshot the in-flight work
- `cd C:/Users/Hansel/Documents/Hansel/Projects/snap-apps && git checkout -b feat/stripe-checkout && git add apps/server/src/credits/ apps/server/src/integrations/stripe-simulator.ts && git commit -m "WIP: stripe checkout seam, uncommitted at audit time"`
- Verify: `git log --oneline -1` shows the WIP commit; `git status` clean.
- Do NOT merge this branch yet — Task 1 finishes it.

### Task 1 (item 2a). Fix the checkout call missing `userId`
`CheckoutRequest` (`apps/server/src/credits/payment-provider.ts:51-65`) requires `userId`; `apps/server/src/credits/credits.controller.ts:170` omits it (type error).
1. Test first: create `apps/server/src/credits/checkout-userid.e2e.test.ts` — start the app under test (mirror an existing `apps/server/src/**/*.e2e.test.ts` for harness shape), POST `/v1/credits/purchases/:id/checkout` with a valid pending purchase and assert a 201 whose body is a real checkout session (or, with no provider configured, `state: 'unavailable'`) — today this route is a 500 due to the missing field. Run `pnpm --filter @snap/server test -- checkout-userid` → expect FAIL.
2. Fix minimally. In `credits.controller.ts` the handler has `tenantId` in scope; add the caller's identity. The file's imports already pull the request context used by other routes — take `req.user.id` (same source other controllers use for `listMembers` checks; confirm the exact request-property name by grepping `apps/server/src/common/session.guard.ts`). New shape:
   ```ts
   return paymentProvider().createCheckout({
     purchaseId: row.id,
     tenantId,
     userId: req.user.id, // <- carry into provider metadata for webhook RLS re-entry
     packCode: row.pack_code,
     credits: row.credits,
     priceAud: row.price_aud,
   });
   ```
   If the handler does not currently receive the request object, add `@Req() req` to its signature (NestJS, `import { Req } from '@nestjs/common'`).
3. `pnpm --filter @snap/server test -- checkout-userid` → PASS. `pnpm --filter @snap/server exec tsc --noEmit` → no errors.
4. Commit: `The checkout call now says who is buying`.

### Task 2 (item 2b). Build the Stripe webhook endpoint
`verifyStripeSignature` (`apps/server/src/credits/stripe-provider.ts:226`) has zero call sites — no webhook exists, so payment without credit grant is possible.
1. Write `apps/server/src/credits/webhook.e2e.test.ts` first: construct a Stripe-style event payload (`type: checkout.session.completed`, metadata `{ tenantId, userId, purchaseId }`), sign it (Stripe CLI `stripe listen` is not available in CI — instead export a test helper that reuses the same HMAC scheme as `verifyStripeSignature`), POST to `/v1/credits/webhook`, and assert: credits granted via `fulfilCreditPurchase` exactly once; a replay returns the same result idempotently; a bad signature returns 400; the endpoint bypasses `SessionGuard` (`@Public()` or equivalent — grep how `auth.controller.ts` register route opts out of auth) and instead relies on signature verification. Run → FAIL.
2. Implement `apps/server/src/credits/credits-webhook.controller.ts`:
   ```ts
   @Controller('v1/credits')
   export class CreditsWebhookController {
     constructor(private readonly credits: CreditsRepo) {}
     @Post('webhook')
     async webhook(@Req() req: RawBodyRequest<Request>) {
       const event = verifyStripeSignature(req.rawBody, req.headers['stripe-signature'] as string);
       if (event.type !== 'checkout.session.completed') return { received: true };
       // idempotency: fulfilCreditPurchase is keyed by provider + provider_ref
       // (unique index on credit_purchases) and FOR UPDATE-locked — a replay
       // must be a no-op, never a double grant.
       await this.credits.fulfilCreditPurchase({ provider: 'stripe', providerRef: event.id });
       return { received: true };
     }
   }
   ```
   Register in `apps/server/src/app.module.ts` (while there, REMOVE the duplicate `VouchersController` entry — item 2b bundles it only if present in the array; otherwise leave for the Stage 3 stub task). Wire the webhook secret as a required var in `apps/server/src/config.ts` (zod, no default, fail-closed like `TOKEN_SECRET`), and add `STRIPE_WEBHOOK_SECRET` to `deploy/.env.example`.
3. Test → PASS; `pnpm --filter @snap/server exec tsc --noEmit` clean. Commit: `The webhook is the only thing that grants credits, and it refuses a forged stripe`.
4. Note in the PR: the raw-body parser for this route must be `*/*` raw (like the image routes in `main.ts`) or signature verification fails — add a test asserting `req.rawBody` is populated.

### Task 3 (item 6). External monitoring + alerting (build this before the ops tasks)
Nothing outside the box watches anything. Add a repo-owned, external watcher.
1. `deploy/monitor/uptime.sh`: a small POSIX script that checks, over HTTPS from OUTSIDE (run it on a second box or a free service — UptimeRobot/BetterStack/cron-on-another-server; the deliverable here is the script + a documented install line):
   ```bash
   #!/usr/bin/env bash
   # Check every snap-apps endpoint; exit non-zero and print FAILED lines on any miss.
   set -u
   fail=0
   for url in https://snap-apps.gaiada.com https://snap-apps-api.gaiada.com/v1/ready https://snap-apps-app.gaiada.com; do
     body=$(curl -fsS --max-time 15 "$url" 2>&1) || { echo "FAILED $url"; fail=1; continue; }
     case "$url" in
       *"/v1/ready"*) echo "$body" | grep -q '"rlsEnforced": *true' || { echo "FAILED rlsEnforced at $url"; fail=1; } ;;
     esac
   done
   exit $fail
   ```
2. `deploy/monitor/alert.sh`: wraps `uptime.sh`; on failure posts a webhook (env `ALERT_WEBHOOK_URL`, Telegram/Slack/Discord — one HTTPS POST, no SDK) and de-duplicates so a 6-hour outage does not send 72 alerts (keep last state in `/var/lib/snap-monitor/state` on the watching box).
3. Also monitor the things the audit called silent: backup success (`tail -1 /opt/snap-apps/backups/backup.log | grep` for today's dump), disk free (`df -P / | awk 'NR==2{exit $5>90?1:0}'`), Vault sealed state (`curl -s $VAULT_ADDR/v1/sys/health | grep .sealed`), TLS expiry (`openssl s_client -connect snap-apps.gaiada.com:443 </dev/null 2>/dev/null | openssl x509 -checkend 1209600`).
4. Add `deploy/monitor/README.md` with the exact cron line for the external box and the exact `ssh delphi` fallback commands. Verify: run `uptime.sh` from this Windows machine — expected output ends with exit 0 and no FAILED lines (staging is healthy); then break one URL in a copy → exit 1.

### Task 4 (item 3). WAL archiving + PITR and a restore drill
1. In `deploy/docker-compose.yml`, change the postgres service env to add `POSTGRES_INITDB_ARGS: --wal_level=replica --archive_mode=on --archive_command='test ! -f /wal-archive/%f && cp %p /wal-archive/%f'` and mount `wal_archive_data:/wal-archive`. Add a matching volume. (For an existing volume, instead apply via `ALTER SYSTEM SET archive_mode='on'; ...` + restart, or document a one-time pg_basebackup. Check the compose comment block at the postgres service first — it already acknowledges this gap.)
2. `deploy/backup.sh`: keep the existing pg_dump; add `pg_basebackup` weekly (or rely on WAL archive for the rolling window) and add `--if-exists` clean restore script:
3. New `deploy/restore.sh` (this is the part that has never existed):
   ```bash
   #!/usr/bin/env bash
   # Restores the newest dump into a THROWAWAY database — never the live one.
   # Usage: restore.sh [dump-file] [target-db=snapapps_restore_test]
   set -euo pipefail
   dump="${1:-$(ls -t /opt/snap-apps/backups/snapapps-*.dump.gz | head -1)}"
   db="${2:-snapapps_restore_test}"
   echo "Restoring $(basename "$dump") into $db"
   zcat "$dump" | docker exec -i snap-postgres pg_restore --dbname="$db" --create --clean --if-exists
   # Proof: the ledger invariant survives restore
   docker exec snap-postgres psql -d "$db" -tAc \
     "select count(*) from information_schema.tables where table_schema='public'" | tee /dev/stderr
   docker exec snap-postgres psql -d "$db" -tAc \
     "select count(*) from transaction_splits" | tee /dev/stderr
   ```
4. Drill: run it on delphi against last night's dump. Expected: table count > 0, split count > 0, exit 0. Record the drill output in `deploy/monitor/README.md` ("restore drilled 2026-09-XX, dump <name>, rows verified"). Commit: `A restore that has actually been run, not just a backup that has never been`.
5. Guard the dump: `backup.sh` writes via `zcat >` redirect — replace with `set -o pipefail` + write-to-temp-then-rename so an interrupted cron cannot leave a truncated `.gz`.

### Task 5 (item 4). Offsite replication of the ATO originals and DB
1. Choose target: restic → Backblaze B2 or S3-compatible object storage (cheapest for a 1 GB-and-growing originals set + dumps). Add `deploy/offsite.sh`:
   ```bash
   #!/usr/bin/env bash
   # Nightly, after backup.sh: push DB dumps + storage originals off the box.
   set -euo pipefail
   restic -r "$RESTIC_REPO" --password-file /etc/snap-apps/secrets/restic pw backup \
     /opt/snap-apps/backups /opt/snap-apps/data/storage \
     --exclude-backup 2>&1 | tail -3
   restic -r "$RESTIC_REPO" --password-file /etc/snap-apps/secrets/restic forget \
     --keep-daily 7 --keep-monthly 12 --prune
   ```
2. Install on delphi as a cron step 30 min after the 03:15 backup; secrets in `/etc/snap-apps/secrets/restic` + `/etc/snap-apps/secrets/restic.env` (chmod 600, per repo rule). Verify by running once: `restic snapshots` lists 2 paths; then `restic restore latest --target /tmp/verify` on a sampled file and `cmp` it against the original.
3. Update `deploy/backup.sh:16-18` comment and `docs/DEPLOY.md §9` so the stale pointer now names the real script. Commit: `The legal record now has a second copy on a second continent`.
4. Also fix `backup.sh:50` 90-day snapshot prune vs 5-year ATO retention: originals are never deleted (correct); make the tar snapshot retention explicitly a cache comment, since restic is now the durable copy.

### Task 6 (item 2c/quarantine). Merge or keep the Stripe work quarantined
- If Tasks 1–2 are green and staged behind a config flag: merge `feat/stripe-checkout` — the buy flow stays "unavailable" (`noPaymentProvider`) until `STRIPE_SECRET_KEY` is set in staging env, which no one sets yet.
- If not green by end of Stage 1: keep the branch open, and delete `apps/server/src/integrations/stripe-simulator.ts` risk instead by verifying `preflight.ts` fatal-on-simulator (commit `38bc6aa`) has a test — `grep -r STRIPE_SIMULATOR apps/server/src/preflight.ts` and its test file; add one if absent.
- Verify: `curl -s https://snap-apps-api.gaiada.com/v1/ready | grep -c rlsEnforced` returns 1 after deploy; buy screen still truthful.

---

## STAGE 2 — Make the AI gate real

### Task 7 (item 1). Enforce grounding as a review gate
Grounding results are stored with `enforced: false` (`apps/server/src/extraction/shadow.ts`); auto-accept uses model self-reported confidence only (`apps/server/src/extraction/validators.ts`, CONFIDENCE_FLOOR 0.85).
1. Test first: `apps/server/src/extraction/grounding-gate.test.ts` — build a fake extraction whose `payableAmount` has model confidence 0.99 but a grounding report showing NO supporting span on the page; run the acceptance decision function; assert it returns `needs_review`. Expect FAIL (today it auto-accepts).
2. Implement: in the acceptance path (wherever `validators.ts`'s verdict is consumed — `apps/server/src/extraction/run.ts`), combine: `ungrounded critical field → reviewStatus 'needs_review'` even when confidence ≥ floor. Keep grounding READ from the existing stored report (do not re-run); if the grounding report is missing for a capture (legacy rows), treat as ungrounded → needs_review (fail-closed, per README rule 4).
3. Also flip `enforced` semantics: keep writing the full shadow report (do not lose the data), but the accept decision must now consume it. Update the comment block at `shadow.ts:268-273` to state the new contract.
4. Test → PASS. Add a legacy-row test (no grounding report → needs_review). `pnpm --filter @snap/server test -- extraction` → all green. Commit: `A total the page does not say is a total we do not trust`.

### Task 8 (item 5). Fail validation for non-AU tenants on rules-load failure
`apps/server/src/worker.ts:355-364` leaves `taxRules = null` on load failure — AU-only is correct, but an Indonesian tenant then validates under the wrong jurisdiction.
1. Test: `apps/server/src/worker/rules-failure.test.ts` — simulate `rulesFor()` throwing for a tenant whose `tax_rules_id` is set (Indonesia); assert the extraction job finishes with the document marked unvalidatable/needs_review AND `saveExtraction` NOT called with null rules. Expect FAIL.
2. Implement in `worker.ts`: capture `tenantCountry`/`tax_rules_id` before the try; on catch, if the tenant expects a rule set (i.e. `tax_rules_id` truthy), do NOT run the extraction loop — record the failure via the existing `saveExtractionFailure` and release the job with backoff (same handling the model-failure path uses), so the capture is preserved and retried when rules recover. Keep the AU case (`tax_rules_id` null) exactly as today — comment block 343–353 stays true.
3. Test → PASS; run the existing `tax-code-country.e2e.test.ts` to prove no regression. Commit: `An Indonesian receipt is never validated as an Australian one, even when the rules break`.

### Task 9 (item 22). Persist PDF bytes for statement classification
`classifyCapture` defaults multi-page intake captures to 'receipt' because raw PDF bytes are not kept (`apps/server/src/worker.ts` — grep `classifyCapture`).
1. Test: unit test asserting that a 3-page PDF upload through the normal capture path produces a capture whose classification is resolved from the PDF bytes, not defaulted.
2. Implement: store the original PDF in the existing content-addressed storage (`STORAGE_DIR`) keyed like images, and have `classifyCapture` read it from storage (bounded size — it is already ≤ 30MB via the upload cap). If storing is more than a small change (schema check first: `docs/data-model.sql`, migration 0003), the minimal alternative is to pass the in-memory bytes to `classifyCapture` at the demux point where they still exist — prefer whichever avoids a migration.
3. Test → PASS. Commit: `A statement is classified by its own bytes, not by a default`.

### Task 10 (item 20). Cost caps on statement extraction
One model call per page, no ceiling, no tenant quota (`apps/server/src/statements/pdf-statement-import.ts`, `captures.controller.ts:268`).
1. Test: `apps/server/src/statements/page-cap.test.ts` — a 60-page PDF import is refused at intake with a clear client-facing error; a 30-page one proceeds. Expect FAIL.
2. Implement: cap `pageTexts.length` at a constant `MAX_STATEMENT_PAGES = 40` in `pdf-statement-import.ts` (throw a typed error mapped to 413 by `errors.filter.ts`). Add a per-tenant daily extraction budget in `captures.controller.ts`: a single counter query against today's extraction count for the tenant, refuse 429 when exceeded; set `quotaExhausted` the way the TODO at line 268 expects. Config in `config.ts` (zod, sensible staging defaults, overridable).
3. Test → PASS. Commit: `A thousand-page statement cannot be a thousand paid model calls`.

### Task 11 (item 8). Run the licence floor in production, and fix the test-count claim
1. Test: `apps/server/src/extraction/licence-floor.test.ts` — fake sidecar `/health` declaring `WEIGHTS_LICENCE: 'cc-by-nc'`; assert the shadow stage records a floor violation and the preflight fails boot when the configured engine violates the apache-2.0/mit floor. Expect FAIL.
2. Implement: in `apps/server/src/extraction/shadow.ts` (or the sidecar client `packages/docai/src/engines/sidecar.ts` consumer), call `health()` and cross-check `WEIGHTS_LICENCE` with `violatesLicenceFloor` (`packages/docai/src/registry.ts:111`); on violation, fail the stage loudly (and preflight in production). Registry-configured engines get the same check at startup.
3. Fix the README claim: count real tests in `packages/tax-engine` (`grep -c "it(\|test(" packages/tax-engine/test/*.ts`), then correct `packages/tax-engine/README.md` lines 11 and 125 to the true figures (or add the missing tests if the 217 intent is real — decide by diffing claimed case names against actual ones; missing-name tests are cheap to add from the README list).
4. Tests → PASS. Commit: `The licence floor is now checked by the thing that runs the model, not only by the test`.

### Task 12 (item 18). Decimal-string the pre-posting money path
Number-accumulated gap checks at `apps/server/src/transactions/transactions.repo.ts:334`, `apps/server/src/extraction/run.ts` (linesBalance, gstFreeTotal).
1. Test: in `packages/tax-rules` money tests, add cases with values that sit exactly on the 0.02 tolerance edge (e.g. a sum of 0.015 + 0.005) and assert BigInt-money verdicts, no float drift.
2. Implement: replace `Number(sum)` accumulations with `money.money()`/BigInt sums from `packages/tax-rules/src/money.ts`; tolerances become BigInt comparisons (0.02 = 2/100 as rational). Do this file-by-file with the existing suite green between each.
3. `pnpm test` whole workspace → green (this touches the tax-engine so the golden tests are the safety net). Commit per file: `The gap check counts in BigInt, like the ledger`.

---

## STAGE 3 — Ready for real users

### Task 13 (item 12). Production API environment + EAS production profile
1. Provision: on delphi (or a second host), a production compose override `deploy/docker-compose.prod.yml` — its own Postgres volume, its own ports, `NODE_ENV=production`, simulator refused by the existing preflight. Secrets: new `deploy/.env.prod` on the host (never in repo), `deploy/deploy.sh` gains `--env-file` handling.
2. DNS + TLS: `snap-apps-prod.gaiada.com` (or a dedicated host) via CloudPanel; certbot renewal noted in the monitor script (Task 3 already checks expiry).
3. Mobile: `apps/mobile/eas.json` production profile `EXPO_PUBLIC_API_URL` → the new prod API URL. Update the comment that says "There is no production API yet".
4. Verify: `https://<prod-api>/v1/ready` → `rlsEnforced:true`; an EAS `production` build's sign-in hits prod, not staging (`grep -rn snap-apps-api apps/mobile/eas.json` shows prod URL).

### Task 14 (item 13). Crash reporting in both clients
1. Mobile: add `sentry-expo` (or `@sentry/react-native`) to `apps/mobile/package.json`; init in `apps/mobile/src/app/_layout.tsx` behind `EXPO_PUBLIC_SENTRY_DSN` (absent = disabled — keep the current no-SDK dev behaviour). DSN added to `eas.json` profiles and `deploy/.env.example`.
2. Web: `@sentry/nextjs` in `apps/web`, same env-gated init in `apps/web/src/lib/config.ts` (fail-closed style: absent DSN = no-op).
3. Verify: throw a test error in dev with DSN set → event arrives in Sentry; without DSN → console-only, no crash.

### Task 15 (item 10). Bearer token into SecureStore
1. Test: `apps/mobile/src/api/context.test.ts` — token persists via a storage abstraction that uses expo-secure-store when available. Expect FAIL (current impl is AsyncStorage).
2. Implement in `apps/mobile/src/api/context.ts:16-33`: swap `@react-native-async-storage/async-storage` for `expo-secure-store` (`expo-secure-store` add to `apps/mobile/package.json`; it is Expo-managed — no config plugin needed). Migration: on first read, if SecureStore empty and AsyncStorage has a token, move it and delete from AsyncStorage.
3. `pnpm --filter @snap/mobile typecheck` → clean. Commit: `The session lives where a rooted browser cannot read it`.

### Task 16 (item 11). Hide stub surfaces
1. Mobile: gate the screens shipped by `b790b97` that the server cannot honour — `apps/mobile/src/app/fingerprint.tsx` (says "does not lock the app" at line 136), the rewards/refusal surface, and wallet/alerts screens that hit `apps/server/src/redesign/redesign.controller.ts` in-process Maps. Mechanism: extend `apps/mobile/src/config.ts` (`BUSINESS_FEATURES_ENABLED` pattern already exists) with `EXPERIMENTAL_FEATURES_ENABLED=false` and wrap those tab entries/route guards.
2. Server: mark `redesign.controller.ts` controllers unregistered in `app.module.ts` when the flag is off (config-driven), or leave registered but add a `experimental` route prefix gate. Prefer client-side hiding first (server stubs are harmless if unreachable).
3. Also remove or clearly label the web chat stub (`apps/web/src/components/chat/stub-transport.ts` says "This shell is not connected to a model." at line 98) — gate behind the same env flag.
4. Verify: `grep -rn fingerprint apps/mobile/src/app/\(tabs\)` shows no reachable tab link; E2E/manual: tab bar shows no wallet/alerts/fingerprint entries.

### Task 17 (item 9). Shared-store rate limiting + global cap
1. Test: `apps/server/src/auth/rate-limit.test.ts` extension — after N requests from one IP across TWO simulated app instances, the limit still holds (in-memory impl fails this). Expect FAIL.
2. Implement: back the counters with Postgres (`rate_limit_hits` table, or a single `SET LOCAL`-based window) OR Redis if it must not touch the DB per request — prefer Postgres first (DRY: no new infra). Add a global limiter middleware (e.g. 300 req/min/IP) in `main.ts` beside the ValidationPipe, skip-listing health/static.
3. Test → PASS under both-instance simulation; load sanity via `autocannon -c 50 -d 5 http://localhost:3000/v1/...` locally showing 429s past the cap. Commit: `The limit survives a second process`.

### Task 18 (item 14). Offline capture + queued-write indicator
1. Extend the outbox (`apps/mobile/src/api/outbox.ts`) with a `capture` action type: store the taken image bytes in the durable outbox storage when `createCapture` fails from no connection; flush oldest-first (mechanism already exists — reuse it exactly; do not invent a second queue).
2. UI: a small persistent banner reading pendingWrites() on the capture tab (`apps/mobile/src/app/(tabs)/capture.tsx`) — copy in the app's honest register: "1 capture waiting to send — it goes by itself when you're back online."
3. Test: outbox unit test for capture round-trip offline→flush→server create; UI smoke on web export.
4. Commit: `A photo taken in a truck stop is not lost`.

---

## STAGE 4 — Compliance hardening

### Task 19 (item 17). Retention enforcement + erasure path
1. Migration `packages/db/migrations/00XX_retention_worker.sql`: nothing needed for schema (indexes exist); add the worker job type. In `apps/server/src/worker.ts` job registry, add a nightly `retention-sweep` job: delete (or tombstone per legal advice — flag it in the PR) rows past `retention_until` in `documents` and `captures`, and their storage objects, under the worker's elevated policy.
2. Erasure: `apps/server/src/admin/tenants/erasure.controller.ts` — staff-gated (`SessionGuard, StaffGuard, CapabilityGuard` like the other admin controllers), marks a tenant for erasure, worker job scrubs PII while keeping ledger sums (financial records cannot vanish — anonymise parties, keep the balanced entries; state this tradeoff in the PR).
3. Tests: the refusal tests matter more than the permission — assert a non-staff call returns 403 and the sweep skips rows not yet past retention.
4. Commit: `Retention is now a thing that happens, not a column that is written`.

### Task 20 (item 16). Migration rollback plan
1. `docs/DEPLOY.md` gets §12 "When a migration goes wrong": manual psql drill for the three damage classes (bad column → `ALTER ... DROP`; bad table → drop + re-apply; bad data rewrite → restore from Task 4's drilled dump to a temp DB, extract, re-apply).
2. Script skeleton `deploy/migrate-undo.sh` that takes a migration number and prints (does NOT run) the reverse SQL from a hand-written `down/` directory — creating real down migrations for all 34 existing migrations is out of scope (YAGNI); going forward, each new migration lands with a `down/NNNN.sql` peer.
3. Verify: run the script for 0006 → prints the trigger drops, changes nothing.

### Task 21 (item 23). Secret rotation procedures
1. `docs/SECRETS.md` (new): step-by-step for TOKEN_SECRET (add `TOKEN_SECRET_PREVIOUS` support first: `config.ts` accepts an array of secrets for verification — small, testable change; rotation = swap the two), APP_DB_PASSWORD (`db.mjs appuser` + restart), poller PAT (fine-grained read-only — also closes item 19), Vault token renewal.
2. Vault token renewer: `deploy/vault/renew.sh` (cron, `vault token renew -increment=24h`) + monitor alert on renewal failure. This also closes the alerting half of item 7's VAULT_TOKEN trap.
3. Verify: rotate TOKEN_SECRET in staging with `TOKEN_SECRET_PREVIOUS` set → sessions survive; unset it after the TTL window.

### Task 22 (item 7). Vault unseal safety
1. Auto-unseal is not available for a file-storage dev-tier Vault on a single box — instead: monitor alert on sealed state (Task 3 script) + `deploy/vault/README.md` gains an "Unseal drill" section with the exact 2-share command sequence, and the poll-deploy service gains a pre-check: if Vault is sealed, skip redeploying (grep `poll-deploy.sh` for the deploy trigger point, add `curl -s $VAULT_ADDR/v1/sys/health | grep -q '"sealed":false' || exit 0`).
2. Verify: deliberately seal staging Vault → monitor alert fires within 5 min; poller skips; unseal drill command sequence works.

### Task 23 (items 15, 24). Deploy atomicity + laptop-free builds, medium hygiene batch
1. `deploy/deploy.sh:246`: replace bare `docker compose up -d` with per-service `up -d --no-deps <svc>` + `docker compose wait`/healthcheck gate before moving to the next service, so a failed healthcheck stops the rollout and old containers keep serving until each new one is healthy. Keep `--rollback` semantics; document that migrations run first and rollback is code-only (already true).
2. Resource limits: add `mem_limit`/`cpus` to each service in `deploy/docker-compose.yml` (docai and worker get the largest share; web/api modest; on the shared VPS leave ≥ 2GB headroom for co-hosted sites).
3. APK: port `deploy/build-apk.sh` logic to a GitHub Actions `mobile-build.yml` (uses `EXPO_TOKEN` secret; publishes APK artifact; triggered on tag). Delete the WSL dependency path once CI builds are proven.
4. TLS: rely on CloudPanel auto-renew but add the expiry check (Task 3) as the alarm; delete `docs/DEPLOY.md` §11 port drift by stating "actual ports live in deploy/.env on the host" explicitly.
5. Poller token (item 19): replace the classic `repo`-scope PAT with a fine-grained, contents:read-only, 90-day-expiring token on the `gaiadabali/snap-app` repo; update `poll-deploy.sh` comment and `docs/DEPLOY.md §10` to stop mandating classic PAT.
6. `backup.sh` silent failure (item 21's alert half): cron pipes output into `alert.sh` from Task 3.
7. Multi-page classification, cost caps, licence floor: covered in Stage 2 (Tasks 9–11). Duplicate VouchersController entry: remove in Task 2's app.module edit if still present.
8. Verify: staging deploy produces no 502 window (curl loop during deploy shows <1 failure), all containers have limits (`docker inspect --format '{{.HostConfig.Memory}}' snap-apps-api-1` non-zero), CI mobile build green on tag.

---

## Tests / validation (global)

- Every code task above names its failing test first; the TDD cycle (fail → minimal fix → pass → commit) is mandatory per task.
- Workspace gate before each stage merge: `pnpm typecheck && pnpm test && pnpm test:boundaries` with the local DB up (`node packages/db/scripts/db.mjs up`) and `REQUIRE_DB=1` exported for DB suites — a green run with "197 skipped" proves nothing (README's own rule).
- Post-deploy gate on staging: `curl -s https://snap-apps-api.gaiada.com/v1/ready` shows `rlsEnforced:true`; monitor script (Task 3) exits 0; one capture round-trip through the mobile web export.
- The restore drill (Task 4) and offsite restore sampling (Task 5) outputs are pasted into the PR — a drill without recorded output did not happen.

## Risks, tradeoffs, open questions

- **`req.user` property name (Task 1):** verify the exact session shape via `session.guard.ts` before editing — if there is no `req.user`, the handler must load the member row the same way `documents.controller.ts` confirm does.
- **Grounding enforcement (Task 7) will raise the needs_review rate immediately** — that is correct but visible. Stage it behind a config flag for one week of shadow-comparison before hard-failing, if the operator prefers data over principle.
- **Erasure vs ATO record-keeping (Task 19):** deleting the legal invoice image on request may be legally wrong; the plan anonymises parties and keeps ledger sums. Needs a decision (and ideally advice) before merge — flagged as an open question.
- **Stripe simulator in prod (Task 6):** preflight already refuses it; keep it that way when merging the WIP branch.
- **Auto-unseal not possible (Task 22):** accepted tradeoff — alert + skip-deploy + drill instead of a Vault architecture change.
- **Single-host blast radius is not closed by this plan** (one Postgres, one box) — only survivable. HA/second host is deliberately out of scope until the product has paying users (YAGNI with a date).
- **Mobile store release still blocked by things this plan does not cover** (app-store review, real-world device testing) — items 12/13 make it possible, not automatic.
- **Delphi is shared:** every ops change (WAL, restic, cron) must be namespaced under `/opt/snap-apps` and `/etc/snap-apps` and must not touch ports 80/443/6081/8443 or other vhosts.
