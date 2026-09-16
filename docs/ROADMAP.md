# Where Snap Apps actually is

**Date:** 2026-09-16 · **Status:** consolidation of every prior session
**Verified against:** the running deployment, the repository at `a2ca189`, and
the eleven documents in `docs/`.

This file exists because the knowledge was spread across sessions and across
eleven documents that do not all agree. It is the **single entry point**: what
is live, what is built, what the other documents get wrong, and what is worth
doing next.

It supersedes nothing. Each document below remains the authority on its own
subject — this one says which is which, and corrects the three places where a
document describes a system we no longer have.

---

## 1. What is live, verified today

All three hosts answer 200. Checked by request, not by assumption.

| Address | State | Evidence |
|---|---|---|
| `snap-apps.gaiada.com` | **Live** | 200; marketing, docs, legal, panels |
| `snap-apps-api.gaiada.com` | **Live** | `/v1/ready` → `rlsEnforced: true`, role `snap_app` |
| `snap-apps-app.gaiada.com` | **Live** | 200; the Expo web build of the phone app |

**The two security checks `deploy/deploy.sh` refuses to skip both pass against
the running host:**

- `POST /v1/auth/sign-in` → **404**. The authentication bypass is closed.
- `/v1/ready` reports `databaseRole: snap_app`, `rlsEnforced: true`. The
  connection does not bypass row-level security.

**Sign-in works, via the simulator.** `/v1/auth/google-simulator/identities`
returns the five seeded demo accounts, and signing in as
`kate@marshtransport.example` returns a real session token. An address not on
the allow-list gets 404 — that is the gate working, not a fault. Real Google
credentials are still not issued (`docs/DEPLOY.md` §3), so this is how anyone
gets in today.

**Continuous deploy is running.** The delphi poller intersects the successful
runs of CI and Publish images and rolls out the newest commit green in both,
within five minutes. It has been working since `b26343e` — every commit since
has both workflows green.

### What shipped today

Three commits, pushed to `main`:

- `a5bd4f8` — `DESIGN-HANDOFF.md` and `GAPS.md` committed. They existed only in
  session context; `PLAN.md` already pointed at `GAPS.md` as the build queue.
- `e4730d1` — the sample testimonials removed, and **the three
  `SNAP_ALLOW_PLACEHOLDER_PROOF=1` overrides deleted** from the Dockerfile, CI
  and the image workflow. While those were set the guard could not have fired
  in any automated path.
- `a2ca189` — `Section` gains a `form` (`gutter` / `wide` / `measure`), `Split`
  added, `.t-body` implemented; `/features` and `/how-it-works` rebuilt on them.

---

## 2. The document map

Eleven documents. Which one answers which question:

| Document | Authority on | Read when |
|---|---|---|
| `PLAN.md` | Architecture, D1–D13, the schema, the roadmap phases | Anything structural |
| `OCR.md` | The extraction engine, D14–D29, D34–D37 | Anything about reading a document |
| `GAPS.md` | **The ordered build queue** — five gates, lanes A–E | Deciding what to do next |
| `MONETISATION.md` | Who buys, what for, at what price | Any product or copy decision |
| `ECOSYSTEM.md` | D30–D34 — accounts, credits, points, on-device, ads | Cross-app questions |
| `ON-DEVICE.md` | Why there is no on-device VLM, and what replaces it | Phone capture |
| `AI.md` | Model selection, measured, with exclusions | Choosing or changing a model |
| `DESIGN-HANDOFF.md` | Tokens, type, motion, component anatomy; §12 the open brief | Any UI work |
| `WEB.md` | The marketing site's structure and rules | Site changes |
| `DEPLOY.md` | Everything about shipping and running it | Deploys, environments, secrets |
| `BUILD.md` | Mobile builds, EAS profiles | Phone artefacts |

`docs/contracts/*` are per-phase acceptance contracts. `alpha-gaps.md` is the
stale one — see §4.

---

## 3. What is actually built

Verified in the repository, not taken from a status table.

**The server is substantial.** `apps/server/src` holds admin, ai, auth,
business, captures, credits, documents, export, extraction, images, reports,
settings, summaries, transactions, workspaces. Sixty-one routes.

| Capability | State |
|---|---|
| Capture, dedup, presigned upload, idempotency | **Built** |
| Extraction worker, validators, replay | **Built** |
| Double-entry ledger | **Built** — `POST /v1/documents/:id/transaction`, `POST /v1/transactions/:id/post`, `GET /v1/transactions` |
| BAS report | **Built** — `GET /v1/reports/bas`, with tests including the no-valid-tax-invoice case |
| Credits and points | **Built** — controllers, repos, scan-point pipeline |
| Identity, RLS, workspaces, roles | **Built**, with negative-case tests |
| Offline outbox + idempotency | **Built** (mobile), verified genuinely offline |
| Mobile app | **Built** — 51 screens, personal-only behind D34 |
| Marketing site | **Built**, live, redesigned today |

**Not built:** Xero sync, Stripe billing, PowerSync, the firm/practice console
(schema-only), a real mailer, a real KMS provider.

---

## 4. Where the documents are wrong

Three corrections. Each is a document describing a system that has moved.

**1. `docs/contracts/alpha-gaps.md` is stale.** It lists lanes L (ledger), M
(BAS) and N (drive the app headlessly) as work to do. All three are done — the
ledger and BAS endpoints exist with tests, and `PLAN.md` §8 phase 1c records 21
screens driven headless against Postgres, 79 API calls, 0 failing. What remains
from that file is items #4 (no gold set) and #5 (no calibration), and those are
the same tickets as `GAPS.md` B1 and B3. **The file should be deleted or
reduced to a pointer.**

**2. ~~The OCR sidecar does not ship.~~ FIXED 2026-09-16.** `GAPS.md` A1 read as
a local run to perform; the larger fact was that `services/docai-engine` had no
Dockerfile, was absent from `deploy/docker-compose.yml` entirely, and nothing
set `DOCAI_SIDECAR_URL` — so the OCR stage had never run in production.
`shadow.ts` treats an unset URL as "absent feature" and returns silently, which
is why it went unnoticed. Now a `docai` service with weights baked in, wired to
the worker, verified by reading a real docket through it (`GAPS.md` A1). What
remains is re-running the Phase 0 gate document through capture → extraction,
which needs a live capture rather than a container.

**3. `PLAN.md` open question O2 is answered.** `ECOSYSTEM.md` D32 settles it:
one ecosystem account, a shared identity service the apps federate to, each app
storing only the subject. `PLAN.md` §9 still lists it as open.

---

## 5. The one fact that blocks the commercial case

Everything the product is sold on is a number we have not measured.

- `bench/manifest.json` holds **four documents**, and its own `_comment` says
  every one is **synthetic**, rendered from HTML in that directory.
- The accuracy metric on the live site reads `pending`, deliberately.
- `packages/docai`'s registry has `medianSeconds: null` — *"until someone
  measures it"*.
- Confidence self-reports `calibrated: false`; `LOW_CONFIDENCE_THRESHOLD = 0.8`
  is labelled a placeholder.

`GAPS.md` gate **G2** — *our reading accuracy is measured on real Australian
paperwork* — is closed by **B1, the `au-receipts` gold set**: ≥ 40 real
captured Australian documents with committed per-field ground truth.

**B1 blocks B2, B3, B4 and all of Lane E.** That is the head-to-head, the
calibration, `corrections per 100 documents`, and the competitor comparison —
which is to say, the entire practice-channel pitch.

**B1 is also the one ticket that cannot be delegated, synthesised, or coded.**
It needs real dockets photographed as a user would photograph them. Everything
about accuracy is a guess until they exist.

---

## 6. What is worth building, in order

Three tracks. Only one of them is blocked.

### Track 1 — Unblocked, and it is the wedge

**E1: make per-category GST subtotals visible.** A market scan on 12 September
2026 found no competitor at any price offers per-category tax subtotals.
`document_tax_subtotals` (Peppol BG-23) exists in the schema. It is on the
marketing site as the headline. It is **not yet the named feature in the review
UI or the BAS pack**, which is where a tradie with a mixed Bunnings-and-
groceries docket would feel it.

This is the highest-value buildable thing: it needs no measurement, it is the
one capability nobody else has, and the demo is already written.

### Track 2 — Unblocked, and it is infrastructure

- **A1′: make `docai-engine` a deployable service.** Add it to compose, set
  `DOCAI_SIDECAR_URL`, land one real shadow run in production. Bigger than
  `GAPS.md` implies (§4 above).
- **A2 / A4:** PP-OCRv6 tiers alongside v5, and OpenVINO as the CPU backend.
  Both are measurements with a stated "adopt only if it improves".
- **A3:** report whitespace-insensitive CER as the headline. One-line change;
  the current headline says 6.6% error where the characters are perfect.
- The surfaces `DESIGN-HANDOFF.md` §13 lists as not yet redesigned: `/pricing`,
  `/docs/*`, `/support`, `/legal/*`.

### Track 3 — Blocked on B1, which is blocked on Hansel

B2 (head-to-head), B3 (calibration), B4 (corrections per 100), C1–C3 (grounded
extraction), E2 (score Hubdoc and Dext on our harness), Lane D (the device
tier — gated on B3 via D37).

**Nothing in this track can start until the gold set exists.**

---

## 7. What needs a decision

| # | Question | Where it is argued |
|---|---|---|
| 1 | **The aesthetic is unresolved.** Shipped is warm docket paper and editorial restraint; the stated want is OCR-themed, futuristic, otsuka-air motion. Three directions were tried and all three rejected as generated-looking. | `DESIGN-HANDOFF.md` §12.1 |
| 2 | **No art direction.** otsuka-air's restraint works because real photography carries it. Either commission the photography, or commit to a purely typographic direction where none is needed. | §12.2 |
| 3 | **Dark UI is a real bet.** A tradie in the sun and an accountant reading all day are not a dark-mode-by-default audience. | §12.3 |
| 4 | **The mobile palette has diverged.** `apps/mobile` still runs the old blue grounds. Identity colours match; only the neutrals drifted. One palette, two clients. | §12.5 |
| 5 | **When does the gold set get photographed?** Everything in Track 3 waits on it. | §5 above |
| 6 | **Does D34 reverse?** Business surfaces are dark behind a flag. Reversible in one line, but it hides the revenue line. | `ECOSYSTEM.md` D34 |
| 7 | **Real Google credentials.** The live host runs on the simulator. Ten minutes of console work, no code. | `DEPLOY.md` §3 |

---

## 8. The pattern worth not repeating

`GAPS.md` and `DEPLOY.md` §8 both name it, from different evidence, and today
produced a third instance.

> **The recurring failure is treating a written decision as a shipped one.**

`DEPLOY.md` §8 records six defects that passed their own tests while broken in
what actually runs, and five suites that passed vacuously. `GAPS.md` records a
sign-in guard on the wrong route, a model exclusion documented but never
enforced, an OCR stage behind an unset switch, a licence floor never run.

Today's instance: **three `SNAP_ALLOW_PLACEHOLDER_PROOF=1` overrides**, each
carrying a comment instructing its own removal, none removed — so the guard
that refuses to ship fabricated testimonials could not have fired in any
automated path. The tests were the same shape: they read the live list, so
removing the last sample would have broken the test that proves the guard
works. A test that fails when the data is finally correct is testing the wrong
thing.

The rule that falls out, and it is why every ticket in `GAPS.md` carries a
"done when": **if it cannot be checked, it is not closed** — and an override
that disables the check is part of the thing being checked.
