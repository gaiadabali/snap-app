# Gap closure — the ambitious plan

**Status:** ready to build · **Date:** 2026-09-12
**Sources:** `docs/document-engine-competitive-review.pdf` (five-reference competitive scan),
`docs/OCR.md` §§2, 4.4, 4.7, 4.9, 8, 11–12, `docs/MONETISATION.md` §2

---

## 0. What this is, and how to use it

`docs/OCR.md` says what the engine should be. `docs/MONETISATION.md` says who buys it. This file
is the **ordered work queue between the two**, written so a session with no memory of the review
that produced it can pick up any ticket and finish it.

Every ticket carries: what, where, **how you know it is done**, and what it blocks. Nothing here
is new architecture — it is the existing plan with the gaps a competitive scan found, sequenced so
the cheapest things that unblock the most come first.

**The one-paragraph argument for this ordering.** A five-reference scan found that our design is
well ahead of the field on everything a finance customer buys, and behind two hobby projects on
the only thing that makes a design credible: measurement. Two of the five references are student
demos that have published numbers we have not. So the queue front-loads *making our own numbers
true*, because every commercial claim downstream — and the entire practice-channel pitch — is a
number we do not yet have.

### The five gates

| Gate | Nothing past it ships until | Closed by |
|---|---|---|
| **G1** | The OCR stage has completed one real run on a real document | A1 |
| **G2** | Our reading accuracy is measured on real Australian paperwork | B1, B2 |
| **G3** | Confidence means something — a field at 0.95 is right 95% of the time | B3 |
| **G4** | The extractor points at spans instead of reading pixels | C1–C3 |
| **G5** | `corrections per 100 documents` is measured against Hubdoc and Dext | B4, E2 |

---

## Lane A — Make what already exists true

**Why first:** every one of these is hours, not days, and each removes a reason the current
numbers cannot be trusted. A2 in particular is a one-line change with a claimed +4.6% on our
weakest metric.

### A1 — Start the sidecar and land one real shadow run

**Gate G1. Blocks: everything in Lane B, C, D.**

Today `DOCAI_SIDECAR_URL` is unset in practice and every stored layout in
`apps/server/.storage/**/layouts/*.json` reads:

```
ppocr-v5 failed: docai-engine sidecar not reachable at http://127.0.0.1:8088
```

Shadow mode that never executes collects no evidence, and D20's calibration has nothing to
calibrate against.

- **Where:** `services/docai-engine/` (run it), `apps/server/src/config.ts` (`DOCAI_SIDECAR_URL`),
  `apps/server/src/extraction/shadow.ts` (already wired, do not change its contract)
- **Do:** bring the venv up per `services/docai-engine/README.md`, set the URL, re-run the Phase 0
  gate document (the two-page, 40-line invoice) through capture → extraction.
- **Done when:** `document_layouts` holds a row for both pages with non-empty `blocks`, and no
  `unreadable` entry whose reason is a transport error. Record the run id in this file.
- **Do not:** let the shadow stage throw into the real path. `shadow.ts`'s header states the rule —
  every path either succeeds quietly or is caught and logged as one line.

> **A1 was two tickets, and the bigger one was invisible.** "Bring the venv up and set the URL"
> assumed the sidecar was deployable. It was not: `services/docai-engine` had **no Dockerfile**,
> was **absent from `deploy/docker-compose.yml`**, and nothing anywhere set `DOCAI_SIDECAR_URL` —
> so the OCR stage had never run in production and could not have. `shadow.ts` treats an unset URL
> as "absent config, absent feature" and returns silently, which is correct and is also why no
> alarm ever fired.
>
> **Closed 2026-09-16 (A1′).** `services/docai-engine/Dockerfile` (weights baked at build time, so
> a cold container neither stalls on first request nor needs CDN egress — D17's air-gapped profile
> forbids the latter outright), a `docai` service on the internal network, and
> `DOCAI_SIDECAR_URL` set on the **worker only** (extraction runs there; the API never calls it).
>
> **Verified by running it**, not by reading it: image built, container healthy in 7.2 s, and a
> factory-generated supermarket docket (`gen-supermarket-0043`, tier S) read in 9.1 s — 84 spans,
> zero unreadable, and every field that matters found exactly: total `44.78`, GST `1.75`, ABN
> `08293882425`, and both per-category subtotals `19.20` / `25.58`. Median span confidence 0.988,
> minimum 0.647 — and the 0.647 is on the one genuine misread (a `*` recognised as `大`), which is
> the engine being least sure precisely where it is wrong. That is the correlation D20 needs and
> the first real evidence it exists. `calibrated: false` still, correctly — B3 is untouched.
>
> **Still open from A1 as written:** the two-page Phase 0 gate document has not been re-run through
> capture → extraction against the deployed sidecar, so `document_layouts` does not yet hold its
> rows. That needs a live capture, not a container.

### A2 — Move to PP-OCRv6

**Implements D34. Depends on: A1.**

`requirements.txt` pins `paddleocr==3.7.0`, which **is** current — and whose headline feature is
PP-OCRv6. `ocr_engine.py` asks for v5 by name.

- **Where:** `services/docai-engine/ocr_engine.py` — `_MODEL_NAMES`, `ENGINE_ID`,
  `WEIGHTS_LICENCE` comment, module docstring
- **Do:** add the three v6 tiers (`tiny` 1.5M / `small` 7.7M / `medium` 34.5M) alongside the
  existing `mobile`/`server` keys rather than replacing them — the old pair stays selectable so
  the bench can score v5 against v6 on identical input. Bump `ENGINE_ID` to `ppocr-v6` for the new
  path; the registry treats engine id as provenance, so both must be distinguishable in
  `document_layouts`.
- **Done when:** `bench/ocr_score.py` produces a v5 row and a v6 row on the same fixtures, and
  detection recall is recorded for both. **Adopt v6 only if recall improves** — the claim is
  PaddleOCR's, not ours, and D34 says re-evaluate rather than assume.
- **Licence:** still Apache-2.0. Confirm `violatesLicenceFloor()` in
  `packages/docai/src/registry.ts` still passes.

### A3 — Report reading accuracy whitespace-insensitively

**Implements D35.**

§8.1 measured strict CER 0.0661 and whitespace-insensitive **0.0000** on the same seven regions.
PP-OCRv5 reads `$1,042.60` as `$ 1 , 042.60`. The headline currently says 6.6% error when the
characters are perfect.

- **Where:** `apps/server/bench/ocr_score.py`
- **Do:** make whitespace-insensitive CER the reported headline for money and identifier fields,
  keeping strict CER beside it. Do **not** normalise whitespace where it is semantic — only inside
  an already-matched field.
- **Done when:** the results markdown leads with the whitespace-insensitive figure, strict is still
  present, and the file states in one line why they differ.

### A4 — Evaluate OpenVINO as the CPU backend

**Depends on: A1. Effort: days, not hours.**

`ENABLE_MKLDNN` defaults false because PaddlePaddle 3.3.1's oneDNN executor throws
`ConvertPirAttribute2RuntimeAttribute` on both detection models — verified, documented, and it
leaves us with no CPU accelerator at all. PaddleOCR's published 5.2× CPU figure is quoted for
**OpenVINO**, a different backend we have never tried.

- **Where:** `services/docai-engine/ocr_engine.py`
- **Done when:** median seconds per page is recorded for {no accelerator, OpenVINO} on the same
  fixtures, and `EngineSpec.medianSeconds` in `packages/docai/src/registry.ts` — currently `null`
  with the comment *"until someone measures it"* — is filled in with a real median.
- **If OpenVINO also fails:** record that, keep the workaround, and close the ticket. A measured
  dead end is a result.

---

## Lane B — Earn the numbers

**Why second:** this is the lane that converts the architecture into something sellable. G5, the
commercial claim, is entirely downstream of it.

### B1 — Build the `au-receipts` gold set

**Gate G2. Blocks: B2, B3, B4, all of Lane E.**

`bench/manifest.json` holds four documents and its own `_comment` says every one is **synthetic**,
rendered from HTML in that directory. §8.2 already specifies real gold sets. A synthetic corpus can
exercise a harness; it cannot support a commercial claim or a calibration curve.

- **Where:** `apps/server/bench/corpus/`, `apps/server/bench/manifest.json`
- **Do:** real captured Australian documents — thermal dockets, fuel, Bunnings, groceries with a
  mixed GST/GST-free split, a commercial tax invoice, a multi-page PDF, at least one genuinely
  degraded photo (glare, crumple, low light) and at least one handwritten annotation.
- **Ground truth per document:** every schema field, plus `null` where the document genuinely
  lacks one — an abstention case is a fact about the document and scoring it as a miss is wrong.
- **Done when:** ≥ 40 documents, each with committed per-field ground truth, versioned in git.
- **Watch for:** §8.1 records that an earlier gold set asserted regions were `illegible` that
  PP-OCRv5 read correctly, producing two false `CONFIDENT_WRONG` results. **A ground truth that
  asserts what an engine cannot do is a claim about the engine and must be checked like one.**
  Label from the document, never from an assumption about difficulty.

### B2 — The head-to-head that has never been run

**Gate G2. Depends on: A1, A2, B1.**

§2's table is other people's numbers. §2.1 states plainly that no comparison between ai-parsing,
PaddleOCR and this pipeline has ever been run. Two benchmark runs exist and they are **not**
comparable: different documents, different scoring.

- **Where:** `apps/server/bench/compare.py` (already has pluggable engine adapters that report
  *"not run"* with a reason rather than inventing a score — keep that property)
- **Do:** one run, same documents, per field: our OCR stage (v5 and v6), the current VLM path
  (`gemma4:31b`, `minimax-m3`, `kimi-k3`), PaddleOCR PP-StructureV3, Docling, LlamaParse.
- **Done when:** §2's table has a column of **our** numbers, on **our** documents, per field — the
  exact wording of the Phase 0 gate, which this closes properly.
- **Expected finding, stated in advance so it is not a surprise:** OCR fails by *omission*
  (measured recall 0.875) and the VLM fails by *fabrication* (the gate document's one-digit ABN
  misread at high confidence). Report both failure modes separately; an aggregate score hides the
  only thing that matters.

> **First run: 2026-09-16, `bench/results/20260916T074227Z`. Tier S+P, INTERNAL ONLY.**
> 24 documents (12 tier S, 12 tier P) stratified by tier, degradation and abstention;
> `gemma4:31b` and `minimax-m3`; 2 repeats. `paddleocr` / `docling` / `llamaparse` report **not
> run** (dependencies absent) rather than a score.
>
> **The fabrication prediction did not hold.** Zero hallucinated fields across both engines, with
> 35 correct abstentions on `supplier_abn`. Caveat before this is read as a result: the prompt
> says "NEVER guess a value", and a tier P receipt has nothing ABN-shaped to grab, so this is an
> easy abstention. The gate document's failure was a *misread of a present ABN*, which is a
> different thing this sample does not contain. Fabrication is not disproven — it is unobserved
> here.
>
> **What actually fails is omission, not invention.** `gst_amount` is the weak field: 13 MISS
> against 12 EXACT — the models simply do not find a GST figure that is printed. `line_count` is
> next (6 WRONG). `total_inclusive` came back **47 of 47 correct**, and `supplier_abn` 46 of 47.
>
> **The two engines are close, and differ in the way that matters.** gemma4 omission 8 / misread
> 5; minimax-m3 omission 5 / misread 4, of 167 scored fields each. For a compliance product a MISS
> is a cheaper failure than a WRONG, which is a selection criterion neither model's benchmark
> scores capture.
>
> **This run cannot close G2**, and `provenance.may_publish_headline` enforces that: the tier
> floor is S, so `corrections per 100 documents` prints the refusal. The internal figures are
> 54.2 (gemma4) and 62.5 (minimax-m3), and they are engineering signal, not a claim.
>
> **The first attempt at this run reported 14 WRONG totals and was wrong itself** — tier P money
> was scored with the `text` comparator, so a model returning `16500` against a truth of `16,500`
> was marked WRONG with every digit correct. Twelve of the fourteen were that. See the commit
> "A comparator is a judgement"; `compare.py` now persists `parsed_by_run` and `rescore.py`
> re-derives outcomes with no engine calls, so the next comparator fix costs nothing.

### B3 — Calibration

**Gate G3. Implements D20. Depends on: B1, B2. Blocks: all of Lane D.**

Today the engine self-reports `calibrated: false`, `LOW_CONFIDENCE_THRESHOLD = 0.8` is labelled a
placeholder in `packages/docai/src/pipeline.ts`, and the confidence-vs-error correlation came back
`n/a` for want of data.

- **Where:** `packages/docai/src/pipeline.ts`, `services/docai-engine/ocr_engine.py`
  (`MIN_CONFIDENCE`), `apps/server/src/extraction/validators.ts` (the `auto_accepted` threshold)
- **Do:** temperature scaling against the gold sets. Publish the coverage–risk curve, not a single
  number.
- **Done when:** a field marked 0.95 is right ≈95% of the time on held-out gold data, and
  `auto_accepted` becomes a **risk decision with a stated silent-error rate** rather than a guess.
- **Why this gates the phone:** see D37. The device tier's entire value is its abstention.

### B4 — `corrections per 100 documents`

**Gate G5. Implements `docs/MONETISATION.md` §2.1. Depends on: B1, B2.**

The practice channel buys fewer minutes per document. We already measure this and had not noticed:
`bench/scoring.py` scores every field exact / normalised / wrong / miss / abstain-ok /
hallucinated.

- **Do:** derive `(wrong + miss + hallucinated)` per document × 100 as a first-class reported
  column.
- **Done when:** it appears in `results.md` for every run, on the `au-receipts` set.
- **Not done until E2:** a number with no comparator cannot be quoted to a firm.

---

## Lane C — Grounded extraction

**Gate G4. Implements §4.7, D16, D29. Depends on: G2, G3.**

The current architecture is OCR-free: a vision model is handed a page and asked for JSON, so it
never locates anything, and `docs/extraction-schema.json`'s promised `bbox` cannot be delivered by
`apps/server/src/extraction/types.ts`. §4.7's phrasing is the whole design: the extractor's job is
reduced **from reading to pointing.**

### C1 — The extractor points instead of reads

- **Where:** `apps/server/src/extraction/prompt.ts`, `types.ts`, `run.ts`,
  `packages/docai/src/grounding.ts`
- **Do:** feed the model DocDOM spans plus the image, and ask which spans carry each schema field —
  not "read this page and emit JSON".
- **Done when:** every extracted field carries the span id and bbox it came from, and
  `extraction-schema.json`'s `bbox` is delivered rather than promised.
- **Why it matters:** it converts the model's failure mode from *invent a number* into *point at
  the wrong span*, which is checkable because every answer now has coordinates.

### C2 — No span means null

- **Do:** a field with no supporting span is `null`. **Not low-confidence — null** (D16).
- **Done when:** a test proves a field the OCR never found comes back null rather than as a
  plausible guess.

### C3 — Promote the OCR stage to primary

- **Do:** flip the reading order so T0 → T1 leads and the VLM becomes escalation for abstained
  regions, handwriting, visual table structure and charts. `packages/docai/src/pipeline.ts`
  already implements cheapest-capable-first; this is a routing change, not a rewrite.
- **Done when:** most regions of a typical docket are read at T0/T1, T3 sees the hard 5–15%, and
  blended cost per page is recorded.
- **Hard precondition:** detection recall must clear the bar set in B2. A region the OCR misses is
  **invisible** to a grounded extractor, because the extractor only sees spans. Do not promote on
  0.875.
- **The VLM is demoted, never deleted.** §4.5's engine-disagreement check is the best
  hallucination detector available and it needs two architecturally different readers.

---

## Lane D — The device tier

**Depends on: G3 (D37). Implements §4.9, D32, D33, D36.**

D21 stands and is not negotiable: the device reading is **advisory, never the record**, stored as
`engine = 'device'`. The server run remains authoritative because replay is what makes "re-run
history through a better model" possible.

### D1 — Relax the boundaries rule, deliberately

`test/boundaries.test.ts` asserts mobile depends only on `@snap/api-contract` — *"types, zero
runtime weight"*. An ONNX Runtime or TFLite native module is exactly the runtime weight that rule
exists to prevent, so **this ticket will fail that test by design.**

- **Do:** amend the rule with a named exception and the reason, in the test's own comment. Do not
  delete the assertion.
- **Done when:** the test encodes *which* native weight is permitted and why, so the next person
  adding a dependency still hits the wall.
- **Not a blocker:** the app already builds via `expo run:android` / `expo run:ios` with `eas.json`,
  so a native module needs no Expo Go escape hatch.

### D2 — iOS / Core ML first

**Implements D36.** 61% of Australian smartphone users are on iPhone; premium devices are more
than half of AU sales; the budget Android floor here starts near 8 GB, against §4.9's 2–3 GB design
target.

- **Do:** PP-OCRv6 `tiny` under Core ML, behind the single native module §4.9 specifies.
- **Done when:** the quality gate fires — *"I cannot read the total"*, not *"this looks blurry"* —
  on a real receipt, on a real iPhone, with a calibrated threshold from B3.

### D3 — Android, and the fallback rung

- **Do:** NNAPI → GPU → XNNPACK, with `server-only` as the last rung.
- **Done when:** a device-capability probe selects a tier at runtime and a phone that can run
  nothing still captures exactly as it does today. §4.9 is explicit that the last rung is **a real
  outcome, not a failure** — there must be no device on which this makes the app worse.
- **Respect the thermal cap.** §4.9: *"A capture app that heats the phone gets deleted."*

---

## Lane E — Make the commercial case

### E1 — Per-category GST becomes the headline

A market scan on 12 September 2026 found **no competitor at any price** offers per-category tax
subtotals. Hubdoc has no line items at all; Dext bills them as credits and is not AU-tax-native;
Ozly's free tier now covers the quarterly-BAS gap that `MONETISATION.md` used to claim as wedge #1.

- **Where:** `docs/MONETISATION.md` §2 (done — restated), then the product surfaces
- **Do:** make `document_tax_subtotals` (Peppol BG-23) visible in the review UI and the BAS pack as
  the named feature. A tradie's mixed Bunnings-and-groceries docket is the demo.

### E2 — Measure against the competitors, on the same documents

**Gate G5. Depends on: B4, B1.**

- **Do:** run the `au-receipts` set through Hubdoc and Dext and score them on our own harness.
- **Done when:** we can state *"X fewer corrections per 100 documents than the tool already
  installed in your practice"* with a date and a corpus behind it.
- **This is the practice pitch.** Not provenance, not residency, not air-gap — those are
  procurement words for a buyer we are not selling to, as `docs/OCR.md` §0 already concedes.

---

## What this queue deliberately does not do

- **It does not chase page-to-markdown accuracy.** Four open models have over 1.8M downloads each
  and are measured to two decimals. §2's "do not compete on that race" stands, and the download
  counts confirm it.
- **It does not build our own weights.** D30 stands: own the stage, rent the weights. A fine-tune
  on the AU docket corpus becomes cheap *after* B1 exists, and not before.
- **It does not productise air-gap.** D22 stands: design constraint now, SKU only when a customer
  pays for one.

## The pattern this queue exists to break

Three defects found in one week shared a shape, and the commit that fixed two of them named it:
*"Two decisions that were written down, believed, and never applied."* A sign-in guard on the wrong
route. A model exclusion recorded in `docs/AI.md` and never enforced in code. An OCR stage behind
an unset switch. A licence floor that had never been run against the models the document
recommended.

The architecture is good and the decisions in it are right. **The recurring failure is treating a
written decision as a shipped one.** Every ticket above has a "done when" for that reason — if it
cannot be checked, it is not closed.
