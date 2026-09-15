# The ecosystem: accounts, credits, points, on-device

**Date:** 2026-09-15 · **Status:** decided, partly built
**Extends:** `docs/PLAN.md` (D1, D3), `docs/OCR.md` (D18, D21), `docs/MONETISATION.md`

Snap Apps stops being one product here. It becomes the first app in an
ecosystem that shares one account, and it grows a consumer-side economy —
credits you buy, points you earn — on top of the compliance engine.

Four decisions. **Numbered D30–D33**: `docs/OCR.md` already occupies D24–D29,
and an earlier draft of this file collided with it.

| # | Decision | Choice | Why |
|---|---|---|---|
| **D30** | On-device VLM | **Preview on device, server authoritative** | Keeps D1/D21 intact. The phone reads instantly and offline; the server's read is the record. |
| **D31** | Advertising | **House ads now, one vetted partner later, always self-served** | No third-party SDK next to financial records. |
| **D32** | Identity | **One ecosystem account** — register in any app, sign in to all | The "Gaiada Account". Resolves open question O2. |
| **D33** | Consumer economy | **Credits (money, tenant-scoped) + points (earned, user-scoped)** | Two mechanisms because they answer different questions and travel differently. |
| **D34** | Business surfaces | **Dark behind a flag, not deleted** | Personal-only so it can be designed properly. Reversible in one line — but it hides the revenue line, so the trade is recorded below. |

---

## D30 — On-device is the preview, never the record

The requirement was "a local model that can truly run on a phone". D1, D3 and
D21 all say on-device extraction is **not a data path**, and the reason is not
squeamishness: *extraction is a versioned, replayable function of the image.* A
better model in six months means re-running history. A reading produced on a
handset you no longer control cannot be replayed, and the ATO "true and clear
reproduction" story depends on exactly that replayability.

D21 already allowed a **provisional preview**, and that is the whole
reconciliation:

```
shutter → on-device VLM  → fields appear immediately, offline, $0 marginal
        → upload         → server re-extracts → THIS posts to the ledger
```

Both claims become true at once. The demo is the local model. The record is the
server. Nothing in the architecture has to bend.

**What the preview may never do:** post a transaction, set `is_tax_invoice`,
produce a BAS figure, or write a value the server has not confirmed. It fills
the review screen early. That is all.

**Answered — see `docs/ON-DEVICE.md`. The answer is no VLM.**

The research came back negative on the literal requirement, and the reasoning
is worth keeping: the small VLMs that clear the D23 licence floor (Gemma 4 E2B,
Qwen2-VL-2B class) are **1.7–2.6 GB on disk and 1.7 GB+ of memory before an
image is even encoded**, every published on-phone benchmark is a *flagship*
(S26 Ultra, iPhone 17 Pro), and — the structural objection, which no amount of
hardware fixes — they emit values **without spans**, which D16 forbids outright.

What does work, and gives the same user-visible result: **the text recognition
already built into both operating systems.** Apple Vision on iOS, Google ML Kit
on Android, emitting DocDOM into a deterministic grounded structurer. **Zero
model weights shipped** — 0 MB on iOS, ~0.3 MB on Android — no licence
exposure, and every field carries a span, so D16 holds.

Target: **p90 ≤ 3 s to first field on a 4 GB Galaxy A16 5G and an iPhone 11** —
deliberately floor devices, not flagships.

The honest sentence for a deck is *"the phone reads it instantly and offline,
using the recognition built into iOS and Android; the server's read is the
record"* — **not** "an on-device VLM". A VLM stays on the roadmap as a later
spike (ON-DEVICE.md OD-15) once there are floor-device numbers to beat.

**Correction to an earlier draft of this file:** it claimed D3 had already put
ML Kit on the device. It had not. D3 *decided* a pre-flight quality gate;
`apps/mobile` has no ML Kit or Vision dependency, and the capture screen's
"hold steady" text is static copy with a comment saying no legibility
measurement exists. **Nothing on the device reads anything today.** The first
step is therefore a measurement, not a feature.

---

## D31 — House ads, self-served

Ads sit next to somebody's receipts. A generic network SDK profiles the device,
which is an APP disclosure obligation and a question every accountant's
procurement will ask.

So: **our own inventory first** — free-tax-returns, yourtal, paid tiers — and
the slot built so a single reviewed partner can be dropped in later, served
from our own infrastructure. No third-party script, ever, on a screen showing
financial data.

Placement rules, because "not intrusive" needs to be testable:
- Never between a person and a task they started. No interstitials, no modals.
- Never on the review screen, the ledger, or any BAS surface.
- One slot per screen, in the scroll, dismissible where it repeats.
- Labelled. An ad that looks like product is a deceptive-conduct problem, not a
  design choice.

---

## D32 — One account for the ecosystem

Register in any app — Snap Apps, free-tax-returns, yourtal — and that account
signs you into all of them. A Google account for our own products.

This resolves `docs/PLAN.md` open question **O2** ("Auth: build it, or an
external IdP?"). The answer is now: **a shared identity service the ecosystem
federates to, and each app stores only the subject.** Snap Apps must not become
the IdP itself — a tax app should not be the auth service whose outage takes
down everything else.

**Consequence for this codebase:** `users.subject` already exists and is the
right seam. Nothing stores a password today, which is what makes this cheap.
Points are keyed on `users.id` precisely because that identity is the one thing
every app in the ecosystem will share.

---

## D33 — Credits and points are different mechanisms

Three balances that look alike and are not. Confusing them is how a customer
gets billed for scans they already had.

| | What it is | Scope | Resets | Table |
|---|---|---|---|---|
| **Plan quota** | What a subscription includes monthly | Tenant | Monthly | `usage_counters` |
| **Credits** | Bought with money, or granted free | Tenant | Never | `usage_grants` |
| **Points** | Earned by scanning, spent in another app | **User** | Never | `point_ledger` |

**Credits are tenant-scoped** because a credit buys a scan and a scan happens
inside a workspace. **Points are user-scoped** because they are earned by a
person and redeemed in a different product where a workspace means nothing.
That asymmetry is deliberate.

Credits reuse `usage_grants` rather than adding a second balance — two places
tracking the same number is how they drift. Migration 0024 adds the catalogue
(`credit_packs`) and the money record (`credit_purchases`) around it.

**Free tier:** a new account gets **10 scans** as a `usage_grants` row with
`source = 'signup_bonus'`. Not a plan change, so it never resets and never has
to be reconciled against a subscription.

### Pricing, and the arithmetic that has to be honest

Packs, GST-inclusive AUD, unit price falling with volume:

| Pack | Price | Per scan |
|---|---|---|
| 10 | $0.15 | $0.0150 |
| 50 | $0.70 | $0.0140 |
| 100 | $1.30 | $0.0130 |
| 200 | $2.40 | $0.0120 |
| 500 | $5.50 | $0.0110 |
| 1000 | $10.00 | $0.0100 |

**The margin is not 3x.** The brief assumed $0.005 model cost against $0.015
charged. Measured all-in cost today is **~$0.013/scan** — ~$0.011 blended
extraction plus ~$0.002 storage across the five-year retention window
(`MONETISATION.md` §4). At $0.015 that is ~13% gross on the smallest pack and
*negative* on the largest.

The margin case therefore depends on two things that are not yet measured:

1. **Open-weight primary (D18)** — order-of-magnitude cheaper extraction.
2. **On-device preview (D30)** — if the preview is good enough that the server
   can run a cheaper confirm pass rather than a full extraction.

Storage never goes away: those images are legal records held five years.

**Treat this price list as a floor to revisit once the engine's real cost per
document is measured (`docs/GAPS.md` gate G2), not as a settled model.**

### Points are a liability

The moment a point is redeemable for something of value, outstanding points are
an obligation. In Australia a loyalty scheme that can be varied or cancelled
without notice also runs at the ACL unfair-contract-terms provisions.

So `point_ledger` is **append-only, enforced by grant** — `app_rw` has no
UPDATE or DELETE. A correction is a compensating entry. The outstanding balance
is always reconstructible, which is what makes it auditable and what makes the
eventual terms defensible.

Earning is one point per scan, recorded with the capture id, and a unique index
means a retried capture cannot pay twice.

---

## What is built, and what is not

**Built (migration 0024):** `credit_packs` with the six packs,
`credit_purchases` with constraints that make credits-before-money
unrepresentable, `point_ledger` append-only with a per-scan uniqueness guard,
`v_point_balance`, and RLS on all three — credits by tenant, points by user.

**Not built:** the purchase flow needs a payment processor, and there is still
none. Stripe is phase 6.5 and unwired. `credit_purchases.provider` defaults to
`'manual'` so credits can be granted by hand for a demo without pretending a
checkout exists.

**Not decided:** which on-device model, and whether the redemption side of
points lives here or in yourtal. Redemption writes a negative entry; nothing in
this schema assumes which app does it.

---

## D34 — Business is dark, and that hides the revenue line

`BUSINESS_SURFACES_ENABLED = false` in `apps/web/src/lib/features.ts` (and its
mobile counterpart) hides every business and practice surface so the personal
experience can be designed on its own.

**A flag, not commented-out code.** Commented blocks stop being typechecked,
stop being refactored with everything around them, and rot silently. Everything
stays compiled and one line restores it.

**What a visitor no longer sees, stated plainly because it matters.**
`docs/MONETISATION.md` §3 is explicit that Practice at **$19/client/month is
the primary revenue line** and the direct/sole-trader tier is the funnel
beneath it. With the flag off the marketing site sells **only the funnel**: no
practice door in the hero, no Practice or Practice Plus pricing, no practices
footer column, no practice FAQ. A visitor never learns the accounting-practice
channel exists.

That is a deliberate instruction and it is fully reversible. It is recorded
here rather than left in a chat log because **an investor shown this site is
being shown the funnel, not the business** — and whoever prepares that
conversation needs to know it.

**The edge case that was most likely to break, and was handled:** a user whose
only workspace is a business. They get a dedicated screen explaining the
surfaces are off, that nothing in their books has changed, and an offer to
create a personal workspace — not a crash, an empty dashboard, or a redirect
loop. Staff impersonating a business tenant keep the impersonation banner
instead of being redirected into a 404, which would have silently dropped it
and violated `docs/WEB.md` §6 rule 4.
