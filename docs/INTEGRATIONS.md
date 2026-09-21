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
