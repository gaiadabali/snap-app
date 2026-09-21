# The six external integrations, and how they are simulated until they are real

**Date:** 2026-09-21 · **Status:** build queue, decided
**Decided by the owner on 2026-09-21:** build all six properly, comment them,
and **simulate real use until the other side agrees and approves the
integration**. Vendors chosen the same day: generic SMTP (nodemailer), **Vault**
self-hosted for KMS, **PowerSync self-hosted** on delphi, and the **full** firm
console.

---

## 0. The rule this whole file exists to honour

Two files in this repository argue, at length, **against** exactly what this
queue builds:

> `credits/payment-provider.ts`: *"No fake provider that 'succeeds'. A stub that
> completes a checkout would make the buy button work in development and fail
> in production, which is the failure mode this repository keeps re-learning: a
> thing that is green everywhere except where it matters."*

> `admin/crypto/kms.ts`: *"a provider that pretended to call a cloud KMS with
> none configured would be worse than an honest absence: it would look wired up
> while silently doing nothing a real KMS does."*

**Both objections stand, and neither is an objection to what is built here** —
they are objections to a *stub inside the real provider*. The distinction this
queue holds to, and every ticket below is checked against it:

| A stub (forbidden) | A simulator (what this builds) |
|---|---|
| Lives inside the real provider as a branch | A **separate implementation**, separately named |
| Short-circuits the protocol — returns a canned success | **Speaks the vendor's real wire protocol**, so the real client code is the code that runs |
| Selected by absence of configuration | Selected by its **own explicit env var**, never inferred |
| Silently becomes production behaviour | **Refused in production** unless `DEMO_ENV=staging`, and reported at boot |

The second row is the load-bearing one. A simulated Stripe that returns
`{paid: true}` tests nothing. A simulated Stripe that serves the real Checkout
Session REST shape and signs its webhook with the real `Stripe-Signature` HMAC
scheme means **the only untested line when the live key arrives is the key
itself.** That is the standard every ticket here is held to, and it is the
standard `GOOGLE_SIGNIN_SIMULATOR` already set: the simulator is triple-gated,
and `preflight.ts` counts it as a real sign-in method *because it genuinely
signs people in*.

### The gate every lane shares

**G-SIM — no simulator can be what is live by accident.** For each of the six:
its own `*_SIMULATOR=true` variable; never inferred from `NODE_ENV`, `DEMO_ENV`
or the absence of credentials; `preflight.ts` FAILS a production boot that
selects a simulator without `DEMO_ENV=staging`, and WARNS on one that has it.
*Done when:* a test boots each subsystem with `NODE_ENV=production` and the
simulator selected, and asserts the process refuses.

---

## 1. Order, and why

Dependencies are not preference here — two of them are in the schema already.

```
X  foundation (gating + preflight + the simulator harness)
|
+- K  Vault KMS --------------+
|                             +- Y  Xero sync   (accounting_connections stores
+- N  SMTP mailer --+         |                  KMS-wrapped tokens)
|                   +- F  firm console (full)
+- P  Stripe -------+            (invites need N; billing rollup needs P)
|
+- Q  PowerSync (independent of all of the above)
```

`packages/db/migrations/0007_ops.sql` already declares `jobs.kind = 'xero_push'`
and an `accounting_connections` table whose tokens are *"AEAD ciphertext,
KMS-wrapped DEK"*. So Xero cannot be built before the KMS is real without
inventing a second, weaker way to store a credential — which is how a codebase
ends up with two.

---

## Lane X — The foundation

**X1 — One way to declare and gate a simulated integration.**
`apps/server/src/integrations/simulation.ts`: an `IntegrationId` union, a
`simulationMode(id)` reader, and the triple-gate. Every lane below uses it; no
lane invents its own env-var convention.
*Done when:* a table-driven test asserts, for all six ids, that the simulator is
off by default, is not enabled by `DEMO_ENV` alone, is not enabled by absent
credentials, and that `NODE_ENV=production` without `DEMO_ENV=staging` refuses.

**X2 — `preflight.ts` learns about all six.** Extends the existing checks rather
than adding a second boot gate.
*Done when:* a production boot with any simulator on and no `DEMO_ENV` returns
`ok: false`, naming the subsystem; with `DEMO_ENV=staging` it returns `ok: true`
with a warning per active simulator. Verified by deleting a check and watching
the assertion fail.

---

## Lane K — Vault, and a real envelope

**K1 — `VaultTransitKmsProvider`.** The real client, against Vault's Transit
engine: `POST /v1/transit/encrypt/:key` and `/decrypt/:key`, which are precisely
`KmsProvider`'s `wrap`/`unwrap` and the reason that seam was drawn.
*Done when:* `ADMIN_KMS_PROVIDER=vault` wraps and unwraps a DEK against a real
`hashicorp/vault` container, a key stored under it decrypts after a **KEK
rotation** in Vault (the property the envelope exists for), and `encryptApiKey`
no longer throws in production under this provider.

**K2 — The simulated Vault speaks the Transit HTTP API.** Not a fake
`KmsProvider` — an in-process HTTP server implementing the transit endpoints, so
`VaultTransitKmsProvider` itself is the code under test.
*Done when:* K1's entire suite passes unchanged against the simulator, selected
only by `KMS_SIMULATOR=true`, and a test asserts the simulator's ciphertext
carries the `vault:v1:` prefix a real Vault emits — because the rotation path
parses it.

**K3 — Vault in compose, and the preflight upgrade.** A `vault` service on the
internal network only; never a published port. `SKIP_CADDY=1` rules apply.
*Done when:* `snap-apps-vault-1` is healthy on delphi, the API unseals against
it at boot, and the existing "LOCAL KMS stand-in" warning is gone from the live
boot log.

> **K1, K2 DONE 2026-09-21. K3 built and verified locally; NOT yet deployed.**
>
> **The seam had to become async, and that is the finding.** `KmsProvider` was
> declared synchronous while its own comment said `wrap`/`unwrap` are "the two
> calls a real provider would make OVER THE NETWORK". Both cannot be true. The
> local stand-in being the only implementation is what kept the contradiction
> invisible; the first real provider was always going to force it. One
> production caller (`admin/ai.controller.ts`) and 13 assertions in
> `kms.test.ts` changed — cheap now, and much less so once Lane Y stores a Xero
> refresh token through the same envelope.
>
> **Verified against a real HashiCorp Vault 1.20.4, not only the simulator.**
> `vault-transit.live.test.ts` is skipped unless `VAULT_ADDR`/`VAULT_TOKEN`
> point at a live Vault, and it was run against one: round trip, a genuine KEK
> rotation (`vault:v1:` ciphertext still decrypting after the key advanced to
> v2), and permission-denied on a bad token. The simulator's fidelity is
> established by the real thing passing the same assertions, which is the only
> way that claim can be made honestly.
>
> **The rotation property had never been executed.** `kms.ts` has claimed since
> it was written that the envelope exists so "rotating the KEK never requires
> re-encrypting every stored secret". Nothing had ever rotated anything. It is
> now a test, twice — against the simulator and against real Vault.
>
> **A refusal the ticket did not anticipate.** `encryptApiKey` now also refuses
> the SIMULATED Vault when `NODE_ENV=production`, and not on cryptographic
> grounds: the simulator's key material is `randomBytes(32)` in the process and
> dies with it, so a key wrapped on a demo host becomes permanently unreadable
> at the next container restart. That is silent data loss, not a weak cipher,
> and a demo host is exactly where restarts are routine.
>
> **The compose config was booted, not just written.** `deploy/vault/config.hcl`
> (file storage, mlock on, TLS off with the reasoning recorded in the file) was
> run in a real container: initialised 3/2 Shamir, unsealed, and the compose
> healthcheck observed flipping `unhealthy` → `healthy`. A sealed Vault reads as
> unhealthy, which is correct and which `curl -f` alone would not have caught.
>
> **The operational cost, recorded rather than smoothed over:** a restarted
> Vault comes back SEALED and nothing unseals it automatically — auto-unseal
> needs the cloud KMS this deployment exists to avoid. `snap-deploy` recreates
> containers on a five-minute poll, so somebody unseals it after any deploy that
> touches the service. `deploy/vault/README.md` §1 states which features that
> takes out (credential-reading only) and which it does not (all of capture,
> extraction, ledger, BAS, statements, reconciliation), because treating a
> sealed Vault as a product outage would cause a worse rollback than the fault.
>
> **Still open:** deploying it. `snap-apps-vault-1` does not exist on delphi
> yet, `ADMIN_KMS_PROVIDER` is still unset there (so `local` is live), and the
> transit engine has not been mounted. That is a server-side sequence with a
> one-time key ceremony in it, and it is not something to do inside a build
> commit.

---

## Lane N — SMTP, really spoken

**N1 — `SmtpMailer` (nodemailer).** Implements the existing `Mailer` port. TLS
required, timeouts set, and a permanent-vs-transient distinction on failure.
*Done when:* a magic link is delivered to a real SMTP server and the message
body contains a link that signs in.

**N2 — The simulated SMTP is an SMTP server.** A real in-process SMTP listener
(`smtp-server`), so nodemailer performs an actual EHLO/STARTTLS/DATA exchange.
A stub that captured `send()` calls would never catch a TLS misconfiguration,
which is the failure this transport actually has.
*Done when:* N1's tests pass unchanged against it, and a test asserts the
simulator **rejects** a message over a plaintext connection when TLS is
required — the negative case is the point.

**N3 — Bounces are visible.** SMTP has no webhook, so delivery failure is only
observable synchronously. `mail_deliveries` records every attempt and its
outcome.
*Done when:* a hard 550 is recorded as `permanent` and does not retry; a 421 is
recorded as `transient` and does retry, via `jobs`.

> **N1, N2 DONE 2026-09-21. N3 DONE with one clause amended — read the
> amendment, it is a decision and not a shortfall.**
>
> **Two bugs in this lane were found by probing the real libraries, not by
> reading their documentation, and both would have shipped looking correct.**
>
> 1. **The headline TLS test was green for the wrong reason.** `hideSTARTTLS`
>    does not disable STARTTLS — it removes the capability from EHLO while
>    still honouring the verb, so nodemailer (which issues it anyway under
>    `requireTLS`) negotiated happily. The test was actually passing on
>    `smtp-server`'s **expired built-in certificate**. Simulating a server
>    that genuinely cannot do TLS needs `disabledCommands: ['STARTTLS']`.
>    There are now three distinguishable outcomes — delivered with
>    `secure: true`, `ETLS` when STARTTLS is refused, `ESOCKET` on a bad
>    certificate — so each assertion is about the thing it names.
> 2. **`ESOCKET` is ambiguous and the first classifier got it backwards.**
>    nodemailer uses it for a TLS failure *and* for a refused connection,
>    which need opposite answers. The discriminator is `syscall`: present on
>    an OS socket error (transient — the relay may be restarting), absent on
>    a certificate rejection (permanent — it will not fix itself). A test
>    caught this; reading the code would not have.
>
> **A stale control was found and removed.** `main.ts` carried
> `const magicLink = false` with a comment explaining that no real Mailer
> existed. One does now, and leaving it would have been this project's
> signature bug in reverse — a control still refusing after its reason is
> gone. A production host with working SMTP and no Google could not have
> booted.
>
> **Migration 0034 found a schema-wide surprise.** This database has a
> DEFAULT ACL granting `app_rw=arwd` on every table postgres creates, so
> `GRANT INSERT ... TO app_rw` grants nothing new while *reading* like a
> restriction. `mail_deliveries` now REVOKEs first, and its self-check
> asserts app_rw holds INSERT and nothing else. Both self-checks were proven
> to fire by breaking the grant and the policy in turn and watching each
> raise. Verified against real Postgres: the API writes and gets
> `permission denied` on SELECT.
>
> **Why the table may not be read by the app.** `magic-link/request` returns
> an identical 200 whether the address exists, the mailer is broken, or the
> send was dropped — a deliberate anti-enumeration property whose cost is
> that a total mail outage is invisible from outside. `mail_deliveries` is
> the inside view. Giving app_rw a SELECT policy would turn that log into
> the same enumeration oracle by another route, so it has none.
>
> **AMENDED: a magic link is recorded but NOT queued for retry.** The ticket
> said a 421 "does retry, via `jobs`". For magic links that is the wrong
> thing to build, and `isRetryable()` says so in code with a test: queuing one
> means writing a live bearer token into `jobs.payload`, at rest, readable by
> the worker role, outliving the fifteen minutes it is valid for — undoing
> the point of a short-lived single-use token. It is moot anyway, since
> `magic-link-store.ts` holds issued tokens in the API process's own memory.
> The user presses "send again", which is the same act a retry would have
> performed, and the failure is still recorded so an operator sees it.
> `firm_invite` (Lane F) carries no credential and is the case the retry path
> is for.
>
> **Still open:** the retry CONSUMER. `isRetryable` and the outcome are in
> place; no `mail_send` job kind is enqueued or claimed yet, because nothing
> retryable is sent until Lane F's invites exist. Building a queue with no
> producer would be untestable in the way this file keeps objecting to.

---

## Lane P — Stripe

**P1 — `StripePaymentProvider`.** Implements the existing `PaymentProvider`
port, returning `{state: 'redirect', url}` — the descriptor that port was shaped
around so that StoreKit stays possible.
*Done when:* a purchase produces a real Checkout Session in Stripe **test mode**
and the buy screen opens it.

**P2 — The webhook, which is the only thing that grants credits.** Signature
verified, then `fulfilCreditPurchase`, idempotent on `(provider, provider_ref)`
— both columns and the unique index already exist.
*Done when:* (1) a replayed webhook grants credits exactly once; (2) an
unsigned or wrongly-signed webhook is refused; (3) a test asserts the **redirect
return path grants nothing** — the port's header names this explicitly, so it
gets a test rather than a comment.

**P3 — The simulated Stripe signs real signatures.** Serves the Checkout
Sessions REST shape and emits `checkout.session.completed` with a genuine
`Stripe-Signature` (`t=...,v1=...` HMAC-SHA256 over `t.payload`), so P2's
verification runs for real.
*Done when:* P2's suite passes unchanged against it, and the timestamp-tolerance
rejection is exercised by replaying an old signature.

> **P1, P2, P3 DONE 2026-09-21.** 29 tests, of which the eight that matter
> assert a CREDIT BALANCE against real Postgres rather than that a function
> was called — granting twice or not at all is only visible in the balance.
>
> **No `stripe` SDK.** Two calls are needed (create a session, verify a
> signature) and writing them directly is what makes the simulator worth
> having: the code running against a simulated Stripe is byte-for-byte the
> code that will run against the real one, including the form encoding and
> the HMAC. An SDK would insert a layer the simulator would have to be
> trusted to satisfy rather than one that is exercised.
>
> **Money is converted on the digits, never through a float.** `44.78 * 100`
> is `4477.999999999999`; `price_aud` is a decimal string for that reason and
> `audToCents` works on the characters. It REFUSES sub-cent precision rather
> than rounding it away — and a test asserts the four decimal places
> `numeric(12,4)` actually stores (`'44.7800'`) still convert, because the
> stricter version of that check would have rejected every real price in the
> table. That one was caught by a test failing, and the test was the thing
> that was wrong the first time.
>
> **A refusal the ticket did not ask for.** `paymentProvider()` throws when
> `STRIPE_SECRET_KEY` is set and `STRIPE_WEBHOOK_SECRET` is not. Without the
> second, a payment completes at Stripe and the credits are never granted —
> money taken, nothing delivered, invisible until a customer complains. That
> is a worse failure than not being able to take money at all, so it is
> refused at selection rather than at the first webhook.
>
> **`payment_status` is checked separately from the session being complete.**
> An asynchronous method — BECS direct debit, which is the Australian case —
> completes the checkout session while the money is still in flight.
> Granting there would be granting on an intention.
>
> **The raw body is kept for this one route.** A Stripe signature covers the
> exact bytes sent, so verifying a re-serialised object always fails. The
> JSON parser in `main.ts` retains the original string only for
> `/v1/credits/webhooks/`, rather than holding a copy of every receipt and
> bank statement in memory to serve one endpoint.
>
> **Status codes are "should Stripe retry", not "did it work".** 400 for a
> signature that will never verify; 200 for verified-and-nothing-to-do
> (unhandled event type, already-paid purchase, missing metadata), because
> retrying those forever buries the real failures; 500 only when WE failed,
> which is the one case a retry fixes.
>
> **Found while editing:** `app.module.ts` registered `VouchersController`
> twice. Removed.
>
> **Still open:** nothing is wired to a real Stripe account. `STRIPE_SECRET_KEY`
> is unset everywhere, so `simulationMode('stripe')` answers `absent` and the
> buy screen correctly says card payments are not connected. Going live is
> setting two variables and pointing a Stripe webhook endpoint at
> `/v1/credits/webhooks/stripe`.

---

## Lane Y — Xero

**Y1 — Connect, and store the token like a credential.** OAuth2 + PKCE,
`offline_access`, tokens written to `accounting_connections` through
`encryptApiKey` (Lane K), refresh before expiry.
*Done when:* a connection is stored with `access_token` unreadable in the
database, a test asserts the plaintext appears in no log line, and a refresh
happens without user interaction.

**Y2 — Push through the queue, inside the published limits.** `jobs.kind =
'xero_push'` (already declared). Per-tenant token bucket at **60/min, 5,000/day,
5 concurrent/sec** — `docs/PLAN.md` §345 records these as hard, per-tenant.
Posts a `BankTransaction` or an `ACCPAY` `Invoice`, then attaches the source
image.
*Done when:* a confirmed document reaches Xero with its image attached; a
429 backs off and retries without duplicating; and a test drives 70 pushes in a
minute and asserts the bucket held — **fire-and-forget fails this ticket.**

**Y3 — The simulated Xero enforces the same limits.** Serves the OAuth2 and
Accounting endpoints used, and **returns real 429s with `Retry-After`** at the
documented thresholds.
*Done when:* Y2's suite passes unchanged against it, including the
70-in-a-minute case, which the simulator is what makes runnable at all.

> **Approval note.** Xero App Store listing and certification is the "their side
> approves" step here (`docs/MONETISATION.md` §8: the channel is Xero's). The
> simulator is what keeps Y2 honest for however long that takes.

---

## Lane F — The firm console, in full

The schema landed in `0011_firms.sql` and **nothing has ever read it**: one
`left join firms` in `repo.ts`, and `current_firm_id()` is set by no code path.
So this lane is a product surface, not a wiring job.

**F1 — `app.firm_id` gets set, and a firm user can act as a client.**
The session sets it; acting on a client still requires `app.tenant_id`, per
0011's header — *"the two boundaries compose rather than replacing one another"*.
*Done when:* `rls.test.ts` carries a cross-firm refusal — firm B cannot read
firm A's memberships or subscription — and a firm user's access to a client
tenant is refused when the `firm_memberships` row is removed.

**F2 — Staff, roles and seats.** `firm_role` is `owner|admin|staff`; invites go
out through Lane N; the 10-client minimum is application-enforced, as 0011 says.
*Done when:* each role's permitted actions are a table in one place with a test
per cell, and a staff member cannot invite or bill.

**F3 — The client list and the per-client review queue.** `v_firm_clients` is
declared as *"the practice dashboard's only query"* — the console is held to
that.
*Done when:* the dashboard issues one query for the list, and switching to a
client lands in that client's review queue with the firm identity carried.

**F4 — Cross-client reporting and the BAS pack handoff.**
*Done when:* a firm can produce every client's BAS figures for a period in one
pack, and a client with no valid tax invoice is named rather than silently
omitted — the case `reports/bas` already tests per tenant.

**F5 — Billing rolls up to the firm.** `subscriptions.firm_id` and `seats`
exist, with the one-live-subscription index. Priced per client seat through
Lane P.
*Done when:* a firm with 12 clients is invoiced for 12 seats, adding a client
changes the next invoice, and `subscriptions_one_owner` is proven by a test that
tries to set both `tenant_id` and `firm_id`.

**F6 — The console UI.** The web surface for F1–F5.
*Done when:* it is driven headlessly end to end — sign in as a firm owner,
invite staff, add a client, review one of that client's documents, produce the
BAS pack, see the seat count change.

---

## Lane Q — PowerSync, self-hosted

**Q1 — Replication and sync rules.** A publication over the tenant-scoped
tables; sync rules that bucket by tenant. **RLS is not a sync rule** —
PowerSync reads the WAL, so a rule that forgets a tenant predicate ships
another tenant's rows to a phone, and no policy stops it.
*Done when:* a test asserts a phone authenticated as tenant A receives zero rows
belonging to tenant B, and that removing a bucket predicate makes it fail.

**Q2 — Token endpoint.** The API mints the short-lived JWT PowerSync validates,
against a published JWKS.
*Done when:* an expired or wrong-audience token is refused by the sync service,
asserted against the running service.

**Q3 — The mobile client, and the outbox that already exists.** The app has a
working offline outbox with idempotency; PowerSync must not become a second
write path.
*Done when:* writes still go through the outbox, PowerSync serves reads only,
and a test proves a queued write survives a sync cycle without duplicating.

**Q4 — The service on delphi.** Internal network only.
*Done when:* `snap-apps-powersync-1` is healthy, and a phone syncs against it.

---

## What this queue does not do

- **It does not simulate approval.** Where a vendor must approve (Xero
  certification, a sending domain's DKIM), the simulator covers the wait; it
  never marks the approval itself as done.
- **It does not leave a simulator reachable in production.** G-SIM is a boot
  refusal, not a convention.
- **It does not add a second credential store.** Every token in this queue goes
  through Lane K's envelope.
