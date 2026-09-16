# Building the corpus without access to Australian paper

**Date:** 2026-09-16 · **Status:** plan, for build
**Closes as much of:** `docs/GAPS.md` B1 as can honestly be closed without the client
**Depends on nothing.** This is the unblocking document.

---

## 0. The constraint, stated plainly

`docs/GAPS.md` B1 asks for **≥ 40 real captured Australian documents** — thermal
dockets, fuel, Bunnings, a mixed GST/GST-free grocery docket, a commercial tax
invoice, a multi-page PDF, a genuinely degraded photo, a handwritten annotation
— each with committed per-field ground truth.

**The team is in Indonesia. We cannot photograph Australian paper.** The client
can, and will, but not on our schedule. `docs/contracts/alpha-gaps.md` already
identified this as the one item that cannot be delegated.

So the question is not *"how do we fake B1"*. It is: **what is each kind of
corpus actually evidence for, and how much of the queue can each one unblock?**

---

## 1. A corpus does three different jobs, and they have different evidence bars

Conflating these is how a synthetic number ends up on a slide.

| Job | What it needs | Can synthetic do it? |
|---|---|---|
| **1. Exercise the harness** — does `run.py` → `scoring.py` → `results.md` work end to end, on every format, including abstention and multi-page? | Documents with known truth. Realism is irrelevant. | **Yes, completely.** |
| **2. Develop and regression-test the code** — does the structurer find the total? Does a field with no span come back null? Did this commit break ABN parsing? | Documents that exercise every branch, including the nasty ones. | **Yes, and it is better than real data here** — you can author the exact edge case. |
| **3. Support a claim** — "X fewer corrections per 100 documents than Hubdoc", "a field marked 0.95 is right 95% of the time" | Documents drawn from the **real distribution**, because the claim is a statistical statement about that distribution. | **No. Not partially, not with caveats.** |

Jobs 1 and 2 are most of the engineering. Job 3 is the commercial case.

**The thing that must not happen** is a number produced for job 1 or 2 being
quoted as if it answered job 3. This project has a rule about that, and it cost
us the testimonials last week: *a decision recorded in a document is not a
control*. So §4 makes it a control.

---

## 2. Why synthetic data systematically flatters us

This is the technical heart of it, and it decides which tickets can move.

**Rendered text has perfect glyphs.** A Chromium screenshot of `receipt.html`
produces mathematically ideal letterforms, then `hard.py` blurs, dims, creases
and adds noise on top. That is a *photograph of perfect printing*.

**Real thermal print is not degraded ideal printing. It is differently
printed.** Thermal heads produce broken strokes, ink dropout mid-glyph, uneven
density down the roll, and characters that have partially failed to develop.
Paper curls, so baselines bend rather than skew. Faded thermal loses the *thin*
strokes first, which is why `8` reads as `6` and `5` reads as `6` — a failure
mode a Gaussian blur does not produce.

The consequences are asymmetric, and that asymmetry is the useful part:

| Quantity | On synthetic data | Why |
|---|---|---|
| **Detection recall** | **Optimistic** | Ideal glyph edges are easy to find. Our measured 0.875 will look better than it is. |
| **Character accuracy / CER** | **Optimistic** | No dropout, no broken strokes. |
| **Confidence calibration** | **Actively misleading** | Temperature scaling learns a mapping from *this* distribution. Fitted on synthetic, it will be confidently wrong on real paper — **worse than no calibration**, because `auto_accepted` would then be a risk decision based on a false risk. |
| **Structurer logic** | **Faithful** | "Is the total on a line containing TOTAL?" is a layout question, not a pixel question. |
| **Abstention behaviour** | **Faithful** | Whether a missing ABN yields `null` is a code path. |
| **Grounding / span-pointing** | **Faithful** | Whether every field carries a span id is structural. |
| **Relative layout difficulty** | **Mostly faithful** | A two-page invoice whose total is on page 2 defeats a page-1-only reader on any paper. |

**Read that table as a work plan.** Everything in the "faithful" rows can be
built, tested and finished now. Everything in the "optimistic" and "misleading"
rows waits for real paper.

---

## 3. Three tiers, and what each is allowed to support

| Tier | What it is | Unblocks | Never supports |
|---|---|---|---|
| **S — Synthetic** | Rendered from HTML we author, degraded by `hard.py`. Already exists: 4 documents. | Harness, structurer, abstention, grounding, regression, CI gates | Any published number |
| **P — Public** | Real photographed receipts from public datasets and the open web. Real print, real degradation — but **not Australian**, and not our users' distribution | Detection recall *sanity*, real-glyph robustness, relative engine comparison, a defensible internal go/no-go | A claim about Australian paperwork |
| **R — Real AU** | What B1 actually asks for. Client-provided. | **Everything.** G2, G3, G5 | — |

Tier P is the interesting one and the reason this document is worth writing: it
gets us **real thermal print, real glare, real curl and real dropout** without
Australian paper. An engine that cannot read a Singaporean thermal docket will
not read a Gundagai one, and that is a finding we can have next week instead of
next quarter.

---

## 4. The control, so the tiers cannot be confused

Documents already carry `"synthetic": true` in `manifest.json`. That is a flag,
and a flag is exactly what got the testimonials shipped. Replace it with an
enforced field:

```jsonc
{
  "id": "receipt-easy",
  "provenance": {
    "tier": "S",                    // "S" | "P" | "R" — required, no default
    "source": "receipt.html rendered by gen_corpus.py",
    "licence": "ours",
    "captured_in": null,            // ISO country code; null for synthetic
    "pii_reviewed": true
  }
}
```

Then, in the bench:

1. **`manifest.json` fails to load if any document lacks `provenance.tier`.**
   No default — a missing tier is an error, not a guess.
2. **`results.md` is titled by the weakest tier in the run** and carries a
   banner: *"Tier S/P — not evidence for any published claim. See
   docs/CORPUS.md §1."*
3. **The headline metrics `corrections per 100 documents` and any calibration
   curve refuse to emit at all below Tier R**, printing the reason instead of a
   number. This is the same shape as `compare.py`'s existing adapters, which
   already report *"not run"* with a reason rather than inventing a score — keep
   that property, extend it.
4. **A per-tier breakdown is always printed**, so a mixed run cannot hide behind
   an average.

Point 3 is the whole control. It means nobody — including a future session with
no memory of this conversation — can produce a quotable accuracy number from
data that cannot support one, because the code will not do it.

---

## 5. Building Tier S properly — the corpus factory

What exists: `receipt.html`, `noabn.html`, `invoice-multipage.html`, rendered by
`gen_corpus.py` (Playwright), degraded by `hard.py`. Four documents.

What it should be: **a generator, not four files.** A template plus a seeded
randomiser produces hundreds of documents with ground truth emitted *by
construction* — which is the part that makes this cheap. We never hand-label a
synthetic document; the generator knows the truth because it chose it.

### 5.1 What to vary

**Merchant archetypes**, each a template matching a real AU docket layout:
supermarket (mixed GST/GST-free — *the wedge case*), fuel/servo, hardware,
café, trade supplier tax invoice, telco/utility, a handwritten-annotation case.

Use **generic invented business names**, not real chains. The layouts are not
protectable and matching them is the point; the logos and names are trademarks
and there is no reason to put them in the repository.

**Content variation:** line counts 1–60, GST-free/taxable mixes, ABNs generated
to *pass mod-89* (and a deliberate slice that fails it), day-first dates
including genuinely ambiguous ones (`06/09/26`), missing ABN, missing GST line,
"TAX INVOICE" present/absent, rounding edge cases where GST ≠ total/11 exactly,
credit notes and negative amounts, multi-page where the total is on the last
page.

**Physical variation**, extending `hard.py` from a fixed script to a seeded
pipeline: thermal fade (thin strokes first, not uniform dimming), curl and
non-linear baseline warp, crease shadows, specular glare, low light + high ISO,
motion blur, perspective from a handheld angle, partial occlusion (a thumb),
crop that clips an edge, low-resolution upload.

### 5.2 The one rule that makes it trustworthy

**The generator emits `manifest.json` entries, and the entries are never edited
by hand.** Ground truth is whatever the generator chose. A hand-edited truth is
how §8.1's earlier gold set came to assert regions were `illegible` that
PP-OCRv5 read correctly, producing two false `CONFIDENT_WRONG` results — *a
ground truth that asserts what an engine cannot do is a claim about the engine
and must be checked like one.*

### 5.3 Target

**300+ Tier S documents**, generated reproducibly from a seed, committed as a
manifest plus the generator — and the images either committed or regenerable
byte-identically. Cheap to rebuild, and it is a real CI gate.

---

## 6. Building Tier P — real paper we can legitimately get

Real photographed receipts, so real glyph failure. Ordered by how defensible
each source is.

### 6.1 Public research datasets

| Dataset | What | Watch |
|---|---|---|
| **SROIE** (ICDAR 2019) | ~1,000 scanned receipts with text + box + four key fields | Singapore, not AU. Research-use terms — check before any fine-tune ships |
| **CORD** | ~11,000 Indonesian receipts, line-item level, CC-BY | Indonesian tax structure, but *real thermal print* and line items |
| **DocILE** | ~106k invoices, key-information-extraction benchmark | Mostly US/EU business invoices |
| **FUNSD / XFUND** | Filled forms | For the forms/handwriting class, later |

These give real degradation and, critically, **already-labelled ground truth**,
so they cost hours rather than weeks. CORD in particular is worth having: it is
the closest public analogue to a thermal docket with line items, and the fact
that it is Indonesian is no obstacle to measuring *whether we can read thermal
print* — only to claiming anything about Australia.

### 6.2 The open web

Receipt and invoice images are widely published — template galleries, expense
tool marketing, forum posts, image search. Collecting these for **internal
measurement of a reading engine** is ordinary benchmarking practice. Three
practical rules, none of them ceremonial:

1. **Redact before commit.** Real receipts carry card PANs, names, addresses,
   loyalty numbers and sometimes signatures. Mask them *in the image* and set
   the corresponding ground-truth field to the masked value. We are measuring
   whether a reader finds the total, and none of that is needed.
2. **Record the source URL and licence per document**, in `provenance`. Cheap
   now; impossible later. It is also what lets us drop anything with a licence
   that turns out to matter.
3. **Do not redistribute.** The repository is private. If a public dataset or a
   fine-tuned model ever ships, the licences in `provenance` are re-reviewed
   first. `violatesLicenceFloor()` already encodes this posture for weights —
   this is the same discipline for data.

Scraping respectfully (rate-limited, `robots.txt` honoured) and keeping the
collection internal is the intended use. The PII redaction is the part that
actually matters and it is not optional — not for legal theatre, but because a
corpus full of strangers' card numbers is a liability sitting in a git history
forever.

### 6.3 Australian-shaped without being Australian-captured

A useful middle: **real AU document layouts that are published deliberately.**
The ATO publishes example tax invoices in its guidance. Australian businesses
publish sample invoices and templates. Software vendors publish AU-format
samples. These are real AU *layouts and tax wording* — `TAX INVOICE`, ABN
placement, GST lines — as clean digital documents. Photograph-degrade them with
§5.1's pipeline and they become a decent proxy for AU structure, while still
being Tier P because the degradation is simulated.

### 6.4 Target

**≥ 100 Tier P documents**, PII-redacted, provenance-recorded, with per-field
ground truth (inherited from the dataset where it exists, hand-labelled
otherwise — and hand-labelled **from the document**, never from an assumption
about difficulty).

---

## 7. What this unblocks, ticket by ticket

The point of the whole exercise. Against `docs/GAPS.md` and
`docs/ON-DEVICE.md` §11.

### Fully unblocked — build now, no real paper needed

| Ticket | Why it is unblocked |
|---|---|
| ~~**A1′**~~ **DONE 2026-09-16** | Dockerfile with weights baked in, `docai` compose service, `DOCAI_SIDECAR_URL` on the worker. Verified by reading `gen-supermarket-0043` through it: 84 spans, 0 unreadable, total/GST/ABN/both subtotals exact, median confidence 0.988 |
| **A2** PP-OCRv6 tiers alongside v5 | Adding the tiers is code. *Adoption* needs Tier R; add them selectable and defer the verdict |
| **A3** Whitespace-insensitive CER as headline | A reporting change in `ocr_score.py` |
| **A4** OpenVINO evaluation | A *speed* measurement. Latency does not care whether the glyphs are real |
| **B4** `corrections per 100` as a column | Deriving it from `scoring.py` is one column. §4's control stops it being quoted early |
| **C1** Extractor points at spans instead of reading | **Architectural, not statistical.** Feeding DocDOM spans + image and asking which span carries each field is a prompt and type change, testable on Tier S |
| **C2** No span means null | A code path with a test. The cleanest possible synthetic test |
| **E1** Per-category GST in the review UI and BAS pack | Needs no measurement at all. **The wedge** |
| **OD-1** `snap-ocr` local Expo module | Needs two floor devices, not AU paper |
| **OD-2** DocDOM types into `@snap/api-contract` | Pure refactor |
| **OD-3** `@snap/docai-preview` structurer | Its unit tests are explicitly specified against the synthetic fixtures |
| **OD-4** Boundaries + licence-floor amendments | Test-only |
| **OD-5** `preview_score.py` | Harness. Job 1 |
| **OD-16** Decision-numbering collision | Housekeeping |

**A deliberate resequencing.** `GAPS.md` puts Lane C behind gates G2 and G3.
That dependency is right for **C3** — *"do not promote OCR to primary on 0.875
recall"* is a precondition about real recall. It is **not** right for C1 and C2:
building the pointing mechanism and the no-span-means-null rule does not require
knowing how good the recogniser is, only that it emits spans. Splitting C1/C2
from C3 unblocks the single most valuable architectural change in the queue —
the one that converts the model's failure mode from *invent a number* into
*point at the wrong span* — by weeks.

### Partially unblocked — run it, label the result Tier S/P

| Ticket | What you get | What waits |
|---|---|---|
| **B2** Head-to-head | A full run with our numbers, our documents, per field, per failure mode. Enough to choose an engine | The published comparison |
| **A2 adoption** | v5 vs v6 on identical input | The adopt/reject decision |
| **OD-6** Stage 0 device measurement | Latency, peak memory, cold start — all device facts, real on any image | Fill rate and wrong-when-shown |

### Still blocked — and must stay blocked

| Ticket | Why |
|---|---|
| **B3 Calibration** | §2: fitted on the wrong distribution it is **worse than none**. Build the machinery, ship no curve |
| **B1 headline accuracy** | The definition of Tier R |
| **E2** vs Hubdoc and Dext | A claim about AU paperwork |
| **C3** Promote OCR to primary | Its own hard precondition is real recall |
| **OD-13** Live quality gate | D37: an uncalibrated nag fails both ways |

---

## 8. Tickets

| # | What | Done when |
|---|---|---|
| ~~**X1**~~ | ~~`provenance` replaces `synthetic`; loader **errors** on a missing tier~~ | **DONE 2026-09-16.** `bench/provenance.py`; wired into `compare.py`'s `load_manifest()` beside the ABN check and into `ocr/validate_truth.py`. Verified by deleting the block and watching both refuse |
| ~~**X2**~~ | ~~Tier gate in reporting~~ | **DONE 2026-09-16.** Banner above anything quotable in both `compare.py` and `ocr_score.py`; `corrections per 100` (B4, implemented here) prints the refusal reason and collapses the figure behind a not-quotable disclosure; per-tier breakdown always shown. 24 tests, all asserting refusals, running in CI |
| ~~**X3**~~ | ~~Corpus factory~~ | **DONE 2026-09-16.** `bench/factory/` — 7 archetypes, 4 degradation levels, truth emitted by construction. **300 documents, 2241 line items, 85 mixed GST/GST-free, 23 abstention cases, 106 ambiguous dates**, in 1m42s from seed 20260916. Manifest committed; images gitignored and regenerable. 19 tests pin the arithmetic, in CI |
| ~~**X4**~~ | ~~Tier P intake~~ | **DONE 2026-09-16.** `bench/tierp/` — licence gate (SROIE **refused**: no licence stated), CORD-v2 importer, PII filter using the A1′ sidecar to locate spans. **95 documents**, 4 redacted, `source_row` per document. 35 tests in CI |
| ~~**X5**~~ | ~~Re-run B2 on S+P, internal results file~~ | **DONE 2026-09-16.** `bench/results/20260916T074227Z`, 24 stratified documents x 2 models x 2 repeats. Omission vs fabrication reported apart: **zero fabrication**, omission concentrated in `gst_amount` (13 MISS). Banner and headline refusal in the file itself. Plus `sample.py` (stratified sampler) and `rescore.py` (re-score with no engine calls) |
| **X6** | Split `GAPS.md` Lane C: C1/C2 depend on DocDOM spans existing, not on G2/G3; C3 keeps its recall precondition | `GAPS.md` updated with the reasoning, so the resequencing is a recorded decision rather than a shortcut someone took |

---

## 9. What we hand the client

Because the real ask should be small, specific, and arrive once.

A one-page capture brief: **40–60 documents**, photographed with the app on a
normal phone, covering supermarket with a mixed GST/GST-free split (at least
5 — this is the wedge), fuel, hardware, café, at least 3 trade tax invoices,
one multi-page PDF, at least 5 deliberately degraded (glare, crumple, low
light, a curled thermal roll), one with a handwritten annotation, and at least
2 that are *not* valid tax invoices (no ABN, or no "tax invoice" wording) —
because abstention cases are as valuable as readable ones and nobody ever
thinks to collect them.

They do not need to type ground truth. **We label from the images**, which is
both faster and more reliable than asking a busy person to transcribe — and
§5.2's rule applies: label from the document, never from an assumption about
difficulty.

Until those arrive, everything in §7's first table is buildable, and that is
most of the queue.
