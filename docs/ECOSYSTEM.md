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
| **D32** | Identity | **One ecosystem account** — register in any app, sign in to all | The YourTal account, "Sign in with YourTal" (decided 2026-10-20; it was called the "Gaiada Account"). Resolves open question O2. |
| **D33** | Consumer economy | **Credits (money, tenant-scoped) + YourTal points (earned in YourTal, not held here)** | Two mechanisms because they answer different questions and travel differently. The points are YourTal points (decided 2026-10-20), and Snap Apps' own local points are retired (2026-10-20, built in group plan 2.6). |
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

### Decided 2026-10-20: the identity service is YourTal

The founder chose YourTal's account as the one account. **"Sign in with
YourTal" works like "Sign in with Google"**: YourTal is the OpenID Connect
provider, and Snap Apps and free-tax-returns are its clients. Snap Apps stores
only the YourTal subject in `users.subject`, and registering from Snap Apps
creates a YourTal account. There is no separate "Gaiada Account" and no
Zitadel. The rule above still holds: Snap Apps is a client, never the provider.

- A YourTal account belongs to one region, AU or ID, and records a date of
  birth, so Snap Apps inherits both.
- **No SMS.** People prove who they are with a verified email and passkeys,
  with authenticator-app codes as backup.
- **Teens** (13–17, a YourTal teen account) may use Snap Apps **only when a
  parent invites them**. The teen gets their own space; the inviting parent can
  view it, and the teen is told so. Teens earn no receipt points.

The cross-app plan that builds this is `god/TASKS.md` Phase 3, outside this
repo. YourTal records the same decisions as F99, F102 and F105 in its
`docs/16-decisions.md` § V.

---

## D33 — Credits and points are different mechanisms

> **Local points are retired (founder, 2026-10-20; built in group plan 2.6).**
> Snap Apps no longer awards or shows a points balance. The only points with
> value are YourTal's, paid by YourTal and held in the person's YourTal wallet.
> `point_ledger` and its history stay, read-only: nothing writes it, and no
> screen shows it. See "Local points are retired" below. The rest of this
> section is kept as the record of what the local points were.

Three balances that look alike and are not. Confusing them is how a customer
gets billed for scans they already had.

| | What it is | Scope | Resets | Table |
|---|---|---|---|---|
| **Plan quota** | What a subscription includes monthly | Tenant | Monthly | `usage_counters` |
| **Credits** | Bought with money, or granted free | Tenant | Never | `usage_grants` |
| **Points** (RETIRED) | Was: earned by scanning, spent in another app. Now YourTal's, held in YourTal | **User** | Never | `point_ledger` (history only) |

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

**Spending (built, group plan 7.1.a and 7.1.c, migration 0039).** A scan
spends one credit when its capture is queued for reading, in the same
transaction as the job, and `credit_spends` records which grant paid. Free
credits go first (the signup bonus first), then bought ones, oldest first. A
bought credit is a grant backed by a paid `credit_purchases` row. A scan no
model can read gives its credit back when its last attempt fails. Running out
does not block scanning yet (7.1.b): the scan is recorded with no credit and
still read.

### Pricing, and the arithmetic that has to be honest

> **Superseded 2026-10-21 for consumer pricing:** about 10c a scan, one page
> per snap, packs of 50, 100 and 250 for A$5, A$10 and A$25. See
> `MONETISATION.md` section 3. The packs below are kept for their reasoning.

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

Earning was one point per scan, recorded with the capture id, and a unique
index meant a retried capture could not pay twice. That earning has stopped
(see "Local points are retired" below); the index and the rows remain.

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

**Decided 2026-10-20 (founder):** the points are **YourTal points**. YourTal
points are the one global economy, and the only points with money value. Snap
Apps reports each confirmed receipt to YourTal, and YourTal pays 1 point per
receipt in Australia (10 in Indonesia, which stays a demo), once per receipt,
adults only. Snap Apps buys those points from YourTal at cost (B = 3c a point)
as a point package, alerted at 50%, 80% and 100% and stopping when spent
(founder, 2026-10-20; YourTal F119-F121). Scans on the free signup credits earn
nothing, and there is no per-person cap. So redemption lives in YourTal,
not here. Credits stay Snap Apps' own and never leave Snap Apps.
`point_ledger` stops being a balance people spend. (Settled in group plan 2.6:
it is retired, see below.)

**Built 2026-10-20 (group plan 2.4/2.5, migration 0037), server side only;**
the screens are 2.6. YourTal's contract is its partner guide
(`yourtal/docs/developers/partner-api.md`).

- `yourtal_links` (user-scoped, RLS): one live link per user and one live
  Snap Apps account per YourTal link; history kept (`revoked_at` when the user
  unlinks here, `broken_at` + `broken_reason` when YourTal says
  `link_revoked` or `unknown_link`).
- `GET / POST / DELETE /v1/yourtal/link`: status, link with a one-time code
  (verified email and the person's own session required; teens refused by
  YourTal with `teen_consent_not_allowed`), unlink (YourTal is told first).
  Shape: `YourtalLinkStatus` in `@snap/api-contract`.
- `yourtal_outbox`: a confirmed scan (`saveExtraction`) queues one
  `receipt_scanned` report when the uploader holds a live link and the
  capture arrived after they linked. `externalRef` is a keyed content ref,
  `rcpt:v1:` + an HMAC-SHA256 of the receipt's supplier (valid ABN, else name),
  date, currency, total and document number, when the receipt has a document
  number and `YOURTAL_RECEIPT_REF_KEY` is set. Otherwise it is `sha256:` + the
  SHA-256 of the stored original (`apps/server/src/yourtal/external-ref.ts`).
  One report per capture (migration 0038). The worker drains it in its own loop with the stored body bytes and one
  Idempotency-Key per event; the retry and error rules are at the top of
  `apps/server/src/yourtal/outbox.ts`.
- A likely re-photo is not reported: a capture whose document shares its
  business key (supplier, date, amount, in the workspace) with a capture
  already reported for the same user is recorded as `skipped_duplicate`,
  never sent, and counted in the status (`receipts.skippedDuplicate`).
- **Re-photos across workspaces and users (group plan 2.5.e).** A second photo
  is different bytes, so the image hash alone would be paid again. When the
  receipt has a document number, the ref names what it says, so a re-photo gets
  the same ref. For the same user, in any of their workspaces, it is recorded
  as `skipped_duplicate` and never sent. For another user, YourTal answers
  `duplicate: true`: a receipt earns once, for whoever reported it first. The
  key is HMAC, not a plain hash, so a leaked ref cannot confirm a guess of where
  and when someone shopped; it is Snap Apps' own, never sent to YourTal, and
  never rotated. A receipt with no document number keeps the image hash and the
  in-workspace check only: without a number, two strangers buying the same
  coffee on the same day would collide, and a missed duplicate costs one point
  (A$0.03) where a false match cheats a real person. A skipped row keeps the
  image ref, not the content ref of the report it repeats.
- **Only scans on bought credits earn (group plan 2.5.f, founder decision
  0.10.b).** A scan paid with a bought credit is reported. A scan on the signup
  bonus, a support or staff credit, or no credit at all is recorded as
  `skipped_free` (code `free_scan`), never sent, and counted in the status
  (`receipts.skippedFree`). A credit given back for an unreadable scan does not
  count as paid. The link screens say "Scans on free credits don't earn YourTal
  points."
- `point_ledger` still got its one Snap Apps point per scan when this was built; group plan 2.6 stopped that (below).

**Decided 2026-10-20 (founder, on the 2.4/2.5 review):**

1. **Re-photographed receipts are skipped.** Two photos of one paper receipt
   are different bytes, so the content hash alone would pay twice. The
   business-key check above decides; the cost is that two genuinely identical
   purchases (same shop, day and amount) earn once.
2. **Ledger refusals are final.** `velocity_capped` and the funding refusals
   end that receipt's report; it is not re-sent the next day, although
   YourTal's guide allows it.
3. **Only receipts captured after linking** are reported. Linking does not
   back-fill earlier scans.
4. **`evidence` is the capture id only** (lead's call: minimum data). Nothing
   about the receipt's contents or the person goes to YourTal.

### Local points are retired (founder, 2026-10-20; built in group plan 2.6)

YourTal points are the only points with value, so Snap Apps keeps no points of
its own.

- **No new `point_ledger` rows.** `saveExtraction` no longer calls
  `awardScanPoint`, and the function is deleted
  (`apps/server/src/credits/points.repo.ts` now holds only the two reads). A
  confirmed scan queues the YourTal report and nothing else. Re-extraction
  writes nothing either.
- **No destructive migration.** The table, its append-only grant, its unique
  index and every existing row stay. History is readable through the two
  deprecated reads, `GET /v1/points` and `GET /v1/points/ledger`, which return
  what was earned before the retirement and never change. Nothing in the
  current apps or website calls them; they stay so an older installed app still
  loads, and so support can read the history. They can be removed once those
  app versions are gone.
- **The screens show YourTal points.** The Points screen (phone) and page
  (website, `/app/points`) are the YourTal link: unlinked, linked (date,
  receipts rewarded, waiting, skipped as duplicates, scanned on free credits,
  points reported, a link to
  the YourTal wallet, unlink with a confirm step) and broken, with a message
  for every error code. `pointsReported` is only what YourTal said it granted;
  the balance is in YourTal's wallet. Everything is hidden when
  `GET /v1/yourtal/link` says `available: false`.
- **The rewards list is gone.** `GET /v1/rewards` (a hard-coded list of YourTal
  store deep links), the phone's Rewards screen, and the unbuilt voucher
  redemption (`POST /v1/vouchers/redeem`, which only ever refused) are removed.
  Snap Apps does not fake YourTal's store: it points people to their YourTal
  wallet. The phone's usage screen lost its Points tab.
- **The house ad** that said "Spending them in yourtal is coming" now says what
  is true (link your YourTal account, 1 point a receipt in Australia, adults
  only) and shows only when the link is available.

**Not decided:** which on-device model.

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
