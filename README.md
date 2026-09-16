# Snap Apps

**A BAS and deduction-compliance layer for Australian sole traders and tradies,
sold through accounting practices.**

Photograph a tax invoice. It reads every line, validates the GST against nine
deterministic checks, and posts a balanced double-entry transaction with the
right ATO label already attached.

Not a receipt scanner. The distinction is the product: a scanner gives you a
picture and a total, and leaves the tax treatment to you.

**Live (staging):** <https://snap-apps.gaiada.com> · API
`snap-apps-api.gaiada.com` · the phone app in a browser
`snap-apps-app.gaiada.com`

---

## The one capability no competitor has

**Per-category tax subtotals.**

One supermarket docket for site lunch mixes GST-free fresh food with taxable
packaged goods. Hubdoc, Dext, ATO myDeductions and Ozly all read header totals
only, so none of them can tell you which half is claimable. Snap Apps splits it
per line, using `document_tax_subtotals` (Peppol BG-23) and BAS label mapping
through `tax_codes`.

A market scan on 12 September 2026 found no competitor at any price offering
this. See [`docs/MONETISATION.md`](docs/MONETISATION.md) §2.

---

## Four principles that drive every decision

1. **The original image is immutable and is the legal record.** The ATO accepts
   an electronic copy only where it is a *true and clear reproduction*. Original
   bytes are kept forever (until retention expiry); the normalised copy the
   model sees is separate and derived.
2. **Extraction is a versioned, replayable function of the image.** A better
   model in six months means re-running history — which is why extraction
   cannot live on the device.
3. **The ledger is double-entry and provably balanced.** Splits per posted
   transaction sum to zero, enforced by a deferred constraint trigger in
   Postgres, not by application discipline.
4. **Money is a decimal string, end to end.** Never parsed to a float. A BAS out
   by a cent is wrong.

---

## Repository layout

```
apps/
  server/      NestJS on Fastify — the API, the extraction worker, the bench harness
  web/         Next.js — marketing site, docs, and the signed-in panels
  mobile/      Expo SDK 57 / React Native — the capture app (also exports to web)
packages/
  db/          Postgres schema: migrations, Drizzle declarations, RLS + drift suites
  tax-engine/  The Australian deduction engine (217 golden tests)
  api-contract/ Types shared by server and clients. Imports nothing — that is enforced
  docai/       Document AI: DocDOM, grounding, the engine registry and licence floor
services/
  docai-engine/ Python sidecar: PaddleOCR detection + recognition
deploy/        Compose, Caddy, deploy + poll scripts, systemd units
docs/          Architecture, decisions, and the build queue — see below
```

The boundary rules are tests, not conventions: `test/boundaries.test.ts` asserts
that mobile depends only on `@snap/api-contract` ("types, zero runtime weight")
and that `api-contract` imports nothing at all.

---

## The documents, and which answers what

Start with **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — it is the single entry
point: what is live, what is actually built, and what is worth doing next.

| Document | Authority on |
|---|---|
| [`ROADMAP.md`](docs/ROADMAP.md) | **Start here.** Consolidated state, verified against the running deployment |
| [`PLAN.md`](docs/PLAN.md) | Architecture, decisions D1–D13, the schema, roadmap phases |
| [`OCR.md`](docs/OCR.md) | The reading engine: tiers T0–T3, DocDOM, grounding, D14–D37 |
| [`ON-DEVICE.md`](docs/ON-DEVICE.md) | What can genuinely run on our users' phones, and why it is not a VLM |
| [`GAPS.md`](docs/GAPS.md) | **The ordered build queue** — five gates, lanes A–E, every ticket with a "done when" |
| [`MONETISATION.md`](docs/MONETISATION.md) | Who buys, what for, at what price |
| [`ECOSYSTEM.md`](docs/ECOSYSTEM.md) | Accounts, credits, points, advertising |
| [`AI.md`](docs/AI.md) | Model selection, measured, with exclusions |
| [`DESIGN-HANDOFF.md`](docs/DESIGN-HANDOFF.md) | Tokens, type, motion, component anatomy; §12 is the open brief |
| [`WEB.md`](docs/WEB.md) | The marketing site's structure and rules |
| [`DEPLOY.md`](docs/DEPLOY.md) | Shipping and running it — environments, secrets, the preflight |
| [`BUILD.md`](docs/BUILD.md) | Mobile builds and EAS profiles |

---

## Getting started

**Prerequisites:** Node ≥ 20, pnpm 11.3, Docker (for Postgres 17), Python 3.11+
(only for the OCR sidecar and the bench).

```bash
pnpm install
node packages/db/scripts/db.mjs up          # Postgres 17 in Docker
node packages/db/scripts/db.mjs migrate     # apply migrations
node packages/db/scripts/db.mjs appuser     # create snap_app / snap_worker, print their URLs
```

`appuser` prints two connection strings. **Use them.** Connecting as `postgres`
bypasses row-level security — the boot preflight refuses to start in production
for exactly this reason, because nothing about a running system looks different
when it is wrong.

```bash
pnpm --filter @snap/server dev       # API + worker
pnpm --filter @snap/web dev          # website and panels
pnpm --filter @snap/mobile start     # Expo
```

### Checks

```bash
pnpm typecheck            # every package
pnpm test                 # workspace suites, then each package
pnpm test:boundaries      # the dependency rules
```

**The database suites self-skip without a database**, which means a run with no
`DATABASE_URL` reports "197 skipped" and goes green while proving nothing — not
tenant isolation, not the admin capability refusals, not RLS. `REQUIRE_DB=1`
makes that fatal, and CI sets it.

---

## Deploying

The website and server deploy themselves. A systemd timer on the host asks
GitHub every five minutes what the deployable commit is and rolls it out if it
differs from what is running.

**Deployable is not "newest commit on main."** It is the newest commit whose CI
passed *and* whose images were published — `deploy/poll-deploy.sh` intersects
the successful runs of both workflows, because a commit can have green images
and red tests.

```
merge to main
   ├─ CI ............... typecheck, suites with a real database, RLS assertion, web build
   └─ Publish images ... ghcr.io/gaiadabali/snap-{server,web}:sha-<short>
                              ↓  (the host polls, ≤ 5 min)
                         deploy.sh --pull: migrate, roles, restart
                              ↓
                         verify: /v1/ready rlsEnforced, sign-in 404
```

`deploy/deploy.sh` fails loudly if either verification is wrong. Full detail,
including the manual path and rollback, is in [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Things that will bite you

Collected because each one already cost a day.

- **A skipped suite reads as a green run.** See above.
- **The test runner is not the production runtime.** Vitest emits
  `emitDecoratorMetadata`; `tsx` (which runs the server) uses esbuild, which
  does not. A Nest class with constructor injection works under test and
  receives `undefined` in production. That took out every capability-gated admin
  route with a 500 while its e2e suite passed 6/6, happy path included.
- **The web bundle of the mobile app is subject to CORS; the phone build is
  not.** `CORS_ORIGINS` must name the app's own origin, or every request fails
  at preflight and surfaces as a network error indistinguishable from being
  offline.
- **`latest` is rejected as an image tag, deliberately.** A rollback has to be
  able to name what it is rolling back to.
- **GHCR packages inherit the repository's private visibility.** A token
  belonging to an account that can read the repo still cannot pull the images
  unless it can see the packages.

---

## The rule this project is built around

> **A decision recorded in a document is not a control.**

Six defects once passed their own tests while being broken in what actually
runs, and five suites passed vacuously. Separately: a sign-in guard on the wrong
route, a model exclusion documented but never enforced, an OCR stage behind an
unset switch, a licence floor that had never been run against the models the
document recommended.

They share a shape — *nothing checks the agreement between two correct things* —
and the practical rules that fall out of it are applied throughout:

1. **Run the thing.** The composition is where the defect lives.
2. **Test the refusal, not the permission.** Every gate here has a test
   asserting it *refuses*, several verified by deleting the guard and watching
   the right test fail.
3. **Make the agreement a compile error** where you can, a runtime assertion
   where you cannot.
4. **Fail closed.** An unreadable expiry, a missing database in CI, a local KMS
   in production: refuse. Never treat "unknown" as "fine".

Every ticket in [`docs/GAPS.md`](docs/GAPS.md) carries a "done when" for this
reason. If it cannot be checked, it is not closed.

---

## Status

Australia only. Private repository. Not open source, and not currently taking
external contributions.
