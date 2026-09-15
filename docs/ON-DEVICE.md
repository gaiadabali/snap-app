# On-device preview — what can genuinely run on our users' phones, and what to build

**Date:** 2026-09-15 · **Status:** research and design, for decision · **Specifies:** `docs/ECOSYSTEM.md` D24
**Extends:** `docs/OCR.md` §4.9, D21, D23, D32, D33, D36, D37 · `docs/PLAN.md` D1, D3, §5.1 · `docs/GAPS.md` Lane D
**Does not reopen:** on-device is the preview, the server's read is the record.

Every claim below is tagged: **[verified]** I read the primary source (model card, licence
text, vendor documentation, our own code); **[cited]** a third party's measurement I could not
reproduce; **[estimate]** my arithmetic or judgement, with the working shown. §10 collects the
three lists so nobody has to hunt for which is which. A number with no tag is a defect in this
document.

---

## 0. The answer

**A vision-language model cannot genuinely run on the phones our users own, in the way "the
phone reads it as the shutter closes" implies.** The only small VLMs whose licence clears D23 and
whose reading is good enough to be worth showing are 2–2.6 GB on disk and need 1.7–2.5 GB of
memory before an image is encoded; every published on-phone benchmark for them is on a
flagship (Galaxy S26 Ultra, iPhone 17 Pro), and nobody has published one on a 4 GB mid-range
Android — the phone a tradie actually carries. And structurally, an end-to-end VLM emits values
without coordinates, which is exactly what D16 forbids: a preview total with no span behind it
is the hallucination this whole engine exists to prevent.

**What can run — on an iPhone 11 and a Galaxy A16 5G alike — is the platform's own on-device
text recogniser (Apple Vision on iOS, Google ML Kit on Android) producing text with boxes and
confidences, fed to a deterministic structurer that only ever *points* at spans.** That is
shape (b) from ECOSYSTEM D24, minus the "small on-device LLM" — which is not needed for header
fields and would reintroduce the hallucination and the memory problem. It ships zero model
weights of ours, adds 0 MB (iOS) or ~260 KB (Android) to the binary, fits the existing DocDOM
and grounding contract without a new type, and is a local Expo module rather than an ejection.

**The honest sentence for the deck** is therefore: *"The phone reads the receipt itself,
instantly and offline, using the on-device recognition built into iOS and Android, and shows
you the fields before the server has even received the photo. The server's read is the
record."* Not "an on-device VLM". If a Gemma-4-class model ever fits the floor device, §8
Stage 3 says how we would find out.

**One correction to the brief before anything else.** ECOSYSTEM D24 says shape (b) is "already
half-built: D3 put ML Kit on the device as a quality gate." It did not. `apps/mobile/package.json`
has no ML Kit or Vision dependency, `capture.tsx` renders the words *"Document detected · sharp
· all four corners in frame"* as static copy, and its own comment on `createCapture` reads *"No
on-device legibility measurement exists. Sending a number here would assert a confidence
nobody checked."* **[verified]** D3 is a decision that was written down and believed — the
pattern `docs/GAPS.md` closes with. Nothing on the device reads anything today. This document
starts from zero, which is also why Stage 0 is a measurement, not a feature.

---

## 1. The phones, and the budget they set

### 1.1 Who is holding the phone

| Fact | Figure | Basis |
|---|---|---|
| iOS share of AU mobile web traffic, Aug 2026 | **65.2%** iOS / 34.8% Android | **[cited]** Statcounter, Australia, mobile OS, August 2026 |
| Vendor share, AU, Aug 2026 | Apple 65.2% · Samsung 20.8% · Google 4.4% · Motorola 2.2% · Oppo 1.7% | **[cited]** Statcounter vendor share, Australia, August 2026 |
| Share of AU smartphones sold above $1,000, H1 2026 | **56%**; more than 20% above $2,000 | **[cited]** Telsyte, 17 Aug 2026 |
| Apple's share of H1 2026 unit sales | 49.4%; iPhone +7% YoY, Android −5% "concentrated in sub-premium handsets" | **[cited]** Telsyte, 17 Aug 2026 |

Two things follow. The floor is not exotic: the Android buyer who is *not* on a flagship is
overwhelmingly on a Samsung A-series, and the iPhone buyer who is "several generations old" is
on an iPhone 11–13. And the market is drifting up, which is why D36 sequences iOS first — but a
design that only works above $1,000 excludes the 44% of units sold below it, and the tradie on a
$400 Samsung is precisely the customer whose accountant is buying the practice plan.

### 1.2 The floor devices

| Device | RAM | SoC | Why it is the floor |
|---|---|---|---|
| **Samsung Galaxy A16 5G** (Oct 2024; Samsung AU sells the 128 GB model with **4 GB** RAM) | 4 GB (4/6/8 GB variants exist) | Exynos 1330 or MediaTek Dimensity 6300, no NPU worth the name | The best-selling budget Android in AU retail; **[verified]** Samsung AU product page (4 GB), GSMArena (variants, SoC, date) |
| **iPhone 11 / 12 / 13** | **4 GB** | A13 / A14 / A15, Neural Engine | Still supported by iOS 26 (iPhone 11 is the oldest supported model) **[cited]**; iPhone 14/15 have 6 GB, iPhone 16 and later 8 GB **[verified]** Wikipedia model tables |
| iPhone SE (2nd gen, 2020) | **3 GB** | A13 | The genuine iOS floor; treat as "server-only is fine" |

**What 4 GB means for us.** Android does not give an app a fixed memory quota; it kills processes
under pressure by `oom_adj_score`, background first, foreground last **[verified]** Android
developer documentation on memory management. The operating system and resident services take a
substantial share: a 2024 benchmarking study of on-device LLMs notes that on 8–16 GB phones
*"the minimum effective available memory is around 4GB due to the substantial portion occupied
by the operating system"* **[cited]** arXiv 2410.03613. On a 4 GB device the arithmetic leaves
a foreground app perhaps **1.5–2 GB** before the camera, the OS and our own JS runtime are
counted — **[estimate]**, and the reason a 2.5 GB model is not a candidate however good it is.

### 1.3 The budget, stated as numbers we will be held to

For the recommended design (§3), per platform, measured on the two floor devices in Stage 0:

| Budget line | Target | Abandon if | Basis |
|---|---|---|---|
| **Model weights we ship** | **0 MB** | — | Apple Vision is an OS framework; ML Kit *unbundled* delivers its model via Google Play services, adding "about 260 KB" to the APK **[verified]** ML Kit docs |
| **Binary growth** | iOS +0 MB; Android +~0.3 MB | > 5 MB | Same. (Bundled ML Kit would be "about 4 MB per script per architecture" — not chosen, see §5) |
| **Peak added RAM during recognition** | ≤ 60 MB | > 150 MB measured | **[estimate]**: OCR input bitmap at ≤ 2048 px long edge ≈ 2048×1536×4 B ≈ 12.6 MB; recogniser working set tens of MB; DocDOM JSON < 200 KB |
| **Cold start** (first recognition, including model initialisation) | ≤ 1.0 s warm; first-ever run on Android may wait for a Play services download | > 3 s warm | ML Kit: unbundled model "dynamically downloaded; initialization may require waiting" **[verified]**; pre-warm on camera open |
| **Time-to-first-field** (photo written → fields painted) | p50 ≤ 1.5 s, p90 ≤ 3.0 s | p90 > 5 s | ML Kit: "Real-time on most devices for Latin script" **[verified]**; Apple publishes no figure — **Stage 0 measures both** |
| **Structuring** (DocDOM → fields, JS) | ≤ 50 ms for ≤ 300 spans | > 200 ms | **[estimate]**: regex over a few hundred strings |
| **Thermal / battery** | One inference per shutter; no per-frame work | Any sustained heat | Design constraint (§4.9: "a capture app that heats the phone gets deleted") |
| **Network** | 0 bytes for the preview; +5–50 KB per capture to upload the device reading | — | **[estimate]**: 100–300 spans × ~150 bytes JSON |

For contrast, the same lines for the best licence-clean small VLM are in §2.2.

---

## 2. The candidates, honestly

### 2.1 Shape (a): a small quantised VLM, image → fields

I checked the licence text and size of every small VLM that is plausibly mobile. The D23 floor is
Apache-2.0 or MIT weights, and a model inside an APK is unambiguously redistribution.

| Model | Params | Licence (where read) | On-disk (quantised) | Reading quality | Verdict |
|---|---|---|---|---|---|
| **Gemma 4 E2B** (LiteRT-LM) | effective 2B (raw larger; 1.12 GB of embeddings memory-mapped) | **Apache-2.0** **[verified]** LiteRT-LM model page and Google Open Source blog, Mar 2026. Gemma 1–3 remain under the custom Gemma Terms (not OSI) **[verified]** | **2.58 GB** `.litertlm`; 2.01 GB GPU/web variant **[verified]** HF file tree | Vendor benchmark only; no DocVQA on the card | **Best licence-clean candidate; fails the device budget** — see §2.2 |
| Gemma 3n E2B | raw 5B, "memory overhead comparable to a 2B model" | **Gemma Terms of Use** — custom, not OSI; redistribution must carry the Prohibited Use Policy downstream **[verified]** | 3.14 GB `.task` **[verified]** | — | **Fails D23** regardless of fit |
| Qwen2-VL-2B-Instruct | 2B | **Apache-2.0** **[verified]** HF card | Q4_K_M 986 MB + mmproj Q8 710 MB (f16 1.33 GB) ≈ **1.7–2.3 GB** **[verified]** ggml-org GGUF tree | DocVQA 90.1, OCRBench 794 **[cited]** card | Credible reader; does not fit 4 GB with the OS resident **[estimate]** |
| Qwen3-VL-2B-Instruct | 2B | **Apache-2.0** **[verified]** | ≈ same class **[estimate]** | Card shows charts, no DocVQA number | As above |
| Moondream 2 | 2B | **Apache-2.0** **[verified]** | ≈ 1.5–2 GB **[estimate]** | DocVQA 79.3, OCRBench 61.2 **[cited]** card | As above, weaker |
| InternVL3-1B | 0.9B | **MIT** (LLM component Qwen2.5, Apache-2.0) **[verified]** | ≈ 0.7–1 GB **[estimate]** | Card shows charts, no number | Might fit; autoregressive; no spans |
| SmolVLM-256M-Instruct | 0.3B | **Apache-2.0** **[verified]** | "under 1GB of GPU RAM" for one image **[verified]** card | **DocVQA 58.3, OCRBench 52.6** **[verified]** card | Fits; too weak to read digits on a thermal docket reliably |
| LFM2-VL-450M | 0.45B | **LFM Open License v1.0** — not Apache/MIT **[verified]** | small | OCRBench 657 **[cited]** | **Fails D23** |
| Florence-2-base | 0.23B | **MIT** **[verified]** | ≈ 0.5 GB f16 **[estimate]** | Has `<OCR_WITH_REGION>` — the one small model that emits boxes **[verified]** | Interesting as a *recogniser*, not a field extractor; 768 px input loses small print **[estimate]**; see Stage 3 |
| SmolDocling-256M | 0.3B | **CDLA-Permissive-2.0** **[verified]** — permissive, but not Apache/MIT as D23 is written | small | Emits DocTags with location tokens; 0.35 s/page **on an A100** **[verified]** | Long autoregressive output; the licence needs a D23 ruling; not for a phone |
| PaddleOCR-VL | 0.9B | **Apache-2.0** **[verified]** | GPU-targeted | SOTA on OmniDocBench **[cited]** | Server T2 candidate, not a phone model |
| dots.ocr / DeepSeek-OCR | 3B / 3B | **MIT** / **MIT** **[verified]** | GPU | — | Too large; server candidates |
| GOT-OCR2.0 | 0.7B | **Apache-2.0** **[verified]** | GPU-oriented | — | No phone story |
| Apple Foundation Models (on-device ~3B) | ~3B **[cited]** Apple ML Research | Platform | 0 MB to us | A language model — Apple describes text tasks (summarisation, entity extraction); image input not verified in this pass | **Requires Apple Intelligence: iPhone 15 Pro or later** **[verified]** Apple AU. Excludes every floor device, which is the decisive fact |
| Gemini Nano via ML Kit GenAI / AICore | — | Platform | 0 MB to us | Prompt API accepts image + text | **Device-gated to listed premium models** (Pixel, Galaxy S25/S26, OnePlus 13, Xiaomi 15…) **[verified]** ML Kit GenAI overview. Excludes the A16 |

### 2.2 The strongest (a) candidate against the budget

Gemma 4 E2B is the model an investor will name, because it is Apache-2.0 and Google publishes
on-phone numbers. Those numbers are the argument against it:

| Line | Gemma 4 E2B | Recommended design (§3) |
|---|---|---|
| Weights on disk | **2.58 GB** (a first-run download over mobile data) **[verified]** | **0 MB** |
| CPU memory, text-only, **Galaxy S26 Ultra** | **1,733 MB** **[verified]** | ≤ 60 MB **[estimate]** |
| Vision encoder | "loaded on demand" — size and memory **not published** | n/a |
| Prefill / decode, **S26 Ultra CPU** | 557 tok/s · 46.9 tok/s · TTFT 1.8 s at a 1,024-token prefill **[verified]** | — |
| Prefill / decode, **iPhone 17 Pro CPU** | 532 tok/s · 25.0 tok/s · TTFT 1.9 s at a 1,024-token prefill **[verified]** | — |
| Any number on a **Galaxy A16 / Dimensity 6300** or **iPhone 11 / A13** | **None published.** Every device in Google's table is a 2025–26 flagship, a Mac, a PC or a Pi 5 **[verified]** | Stage 0 measures exactly these |
| Time-to-first-field on the floor device | **[estimate]** — image ≈ 256–512 tokens + prompt ≈ 200, JSON out ≈ 150 tokens. Flagship: ≈ 1.3 s prefill + 3.2 s decode + image encode ≈ **5 s**. Mid-range at 5–10× slower CPU: **20–45 s**, if it loads at all beside the OS in 4 GB | p50 ≤ 1.5 s target |
| Where the total came from | A string; **no span, no box** | A span id and a box, by construction |

MediaPipe's own guidance for this model class: *"The LLM Inference API is optimized for high-end
Android devices, such as Pixel 8 and Samsung S23 or later"* **[verified]**. Google is telling us
which phones it works on, and the A16 is not one of them.

Two further reasons (a) is the wrong shape here even where it fits:

1. **D16.** A VLM emits `payableAmount: "48.50"` with no coordinates. The review screen cannot
   highlight it, `groundValue()` has nothing to ground against, and a wrong value looks exactly
   like a right one. The engine's entire hallucination defence is that a value points at pixels.
   A preview that abandons that is a preview that can invent a total — the one thing it must not
   do on a product whose pitch is that the numbers are right.
2. **Generation is the cost, and it is per token.** Fields on a receipt are ~150 tokens of JSON.
   At 5–10 tokens/s on a mid-range CPU that is 15–30 s of the user watching a spinner — for a
   result the server will replace anyway.

### 2.3 Shape (b): platform OCR + structuring — and why the "small LLM" half is dropped

| Component | iOS | Android |
|---|---|---|
| Recogniser | **Apple Vision `VNRecognizeTextRequest`** — iOS 13.0+; `recognitionLevel` fast/accurate; results are `VNRecognizedTextObservation` with `topCandidates`, each `VNRecognizedText` carrying a normalised `confidence` and `boundingBox(for:)` per character range **[verified]** Apple docs | **ML Kit Text Recognition v2 (Latin)** — Android API 23+; returns `TextBlock` → `Line` → `Element` → `Symbol`, each with bounding box, rotation and confidence; "Real-time on most devices for Latin script" **[verified]** ML Kit docs |
| Weights shipped by us | None (OS framework) | None with the **unbundled** SDK (~260 KB; model via Google Play services) **[verified]** |
| Also available | iOS 26+: `RecognizeDocumentsRequest` — *"scans a document and extracts different groups of text and barcodes… receipts, nutritional labels… forms"*, grouped by words/lines/paragraphs with tables and lists **[verified]** Apple docs. iOS 26 runs on iPhone 11 and later **[cited]** | ML Kit iOS variant exists but statically links ~38 MB per script into the app **[verified]** — not used; Vision is free |
| Resolution guidance | — | "Each character should be at least 16x16 pixels… no accuracy benefit… larger than 24x24" **[verified]** — sets the downscale rule in §3.3 |

**Why no on-device LLM for structuring.** The header fields of an Australian docket are
deterministic to find once you have text with positions: an ABN is eleven digits that must pass
mod-89 (`abnIsValid` already exists on both sides); a total is a money amount on a line carrying
TOTAL / AMOUNT DUE / EFTPOS; a GST figure is money on a line carrying GST; a date is a day-first
pattern inside the plausibility window `validators.ts` already enforces; "TAX INVOICE" is a
keyword; the supplier is the largest-type line above the ABN. `packages/docai/src/grounding.ts`
already contains the normalisers that make `$ 1 , 042.60` equal `1042.60`. A 0.5B text model
(Qwen3-0.6B, SmolLM2-360M — both Apache-2.0) would cost 400–700 MB of memory and 8–20 s of
prefill and decode on the floor device **[estimate]**, and would hand back a value with no span.
Line items are the one place a model earns its keep, and the preview does not need them. If the
deterministic structurer's measured correction rate (§6) turns out not good enough, a structuring
model is a Stage 3 experiment with a number to beat — not a Stage 1 assumption.

### 2.4 Shape (c): our own OCR weights on the phone

`docs/OCR.md` §4.9 and `docs/GAPS.md` Lane D2/D3 plan PP-OCRv6 `tiny` under Core ML / NNAPI.
The weights fit anything: **[verified]** PaddleOCR model tables — PP-OCRv5_mobile_det 4.7 MB
(Hmean 79.0), PP-OCRv5_mobile_rec 16 MB (avg acc 81.29); PP-OCRv6_tiny_det **1.9 MB** (80.6*),
PP-OCRv6_small_det 9.6 MB (84.1*), PP-OCRv6_medium_det 59.4 MB (86.2*), PP-OCRv6_medium_rec
73.3 MB (83.2*), all Apache-2.0; the asterisked figures are on PaddleOCR's internal
multi-scenario set and the v5 figures on a general set, so they are not directly comparable
(their footnote, not mine). PP-OCRv6's page claims `tiny` is "6.1× over PP-OCRv5_mobile on Apple
M4" **[cited]** — a laptop, not a phone.

This is the right *Stage 3*, not Stage 1, for one reason: the weights are the easy part. DB
post-processing (thresholding, contour extraction, polygon unclip), crop-and-warp of each line,
CTC decoding and box assembly all have to be written natively or in JS, and that is the two to
three weeks of work — and the coordinate-bug surface — that platform OCR gives us for free. Do
it when a measured gap in Vision or ML Kit justifies it (§8), or when Android's telemetry terms
(§5) become unacceptable.

---

## 3. What to build

### 3.1 Shape

```
shutter ──► photo written (unchanged; still the legal original)
        │
        ├──► [native, local Expo module `snap-ocr`]
        │      Vision (iOS) / ML Kit unbundled (Android) on a ≤2048px downscaled copy
        │      → DocDOM Partial<Document>: blocks▸lines▸spans, boxes in ORIGINAL pixels,
        │        provenance { engine: 'device-vision' | 'device-mlkit', confidence, calibrated:false }
        │
        ├──► [TS, @snap/docai-preview]  structure(doc) → PreviewFields
        │      deterministic; every field is a GroundedField: value + spanIds + box + weakest confidence
        │      no span ⇒ null (D16), ABN ⇒ mod-89 or null, date ⇒ plausibility window or null
        │
        ├──► review screen paints PreviewFields immediately, marked PROVISIONAL (scan cyan)
        │      Confirm-and-post DISABLED; no document exists yet
        │
        ├──► upload original (unchanged) ─────────────────────────────────► server extraction (the record)
        │
        └──► POST /v1/captures/:id/device-reading { docdom, preview, timings, engine }
               → document_layouts (engine_ids ['device-…'], shadow=true, extraction_run_id NULL)
               → document_field_grounding rows against that layout (enforced=false)
               → NEVER read by saveExtraction; never a current_run_id; never a finding (Stage 1)

server document arrives ──► reconcile per §7 ──► the record replaces the preview, visibly
```

The device is an *engine* in the DocDOM sense (D32) — it emits the same structure the sidecar
does, so grounding, storage, the review overlay and the bench all consume it unchanged. It is
**not** an engine in the server's `chain()`: the server never routes to it, and `permitted()`
never sees it.

### 3.2 Where the pieces live

| Piece | Location | Notes |
|---|---|---|
| Native recogniser | `apps/mobile/modules/snap-ocr/` — a **local Expo module** (`npx create-expo-module@latest --local`; Swift + Kotlin; autolinked during prebuild) **[verified]** Expo docs | Emits DocDOM-shaped JSON directly. The Phase 1 sidecar contract's rule applies verbatim: *"The adapter must not have to translate a foreign shape; that translation is where coordinate bugs live."* Feature-detected: if the module is absent (Expo Go, web), the preview is skipped and capture behaves exactly as today — D33's "server-only is a real outcome" |
| DocDOM wire types | `packages/api-contract/src/docdom.ts` (new) — pure types, no imports; `packages/docai/src/docdom.ts` re-exports them and keeps the helper functions | `docs/OCR.md` §3.1 already reserves this: *"api-contract/ DocDOM wire types added here (mobile renders overlays)"*. One declaration, two consumers; two declarations drift |
| Structurer + normalisers | `packages/docai-preview/` (new) — pure TS, **zero runtime dependencies**, imports types from `@snap/api-contract` only | `@snap/docai` depends on it (server runs the same structurer over its own layouts for the agreement signal and the bench). Never the other way round. `grounding.ts`'s `normalise` moves here and is re-exported from docai, so there is one normaliser |
| Preview screen + upload | `apps/mobile/src/preview/` | The review screen (`document/[id].tsx`) gains a provisional mode; `EditFields` is not shown in Stage 1 |
| Server intake | `apps/server/src/captures/device-reading.controller.ts` (new) | Writes with the app user's own membership through `withTenantAs`, exactly as `shadow.ts` does; reuses `saveLayout` and `saveFieldGrounding` |
| Bench | `apps/server/bench/preview_score.py` (new) + `device-matrix` entries in the gold-set manifest | §6 |
| Boundary rule | `test/boundaries.test.ts` — `ALLOWED_FOR_MOBILE` gains `@snap/docai-preview`, with the reason in the comment; a new assertion that `@snap/docai-preview` has no runtime dependencies and cannot reach `@snap/db`, `@snap/tax-engine` or `@snap/docai` | This is GAPS D1 done deliberately: the test still encodes *which* weight is permitted and why |

### 3.3 The recogniser contract (native module → DocDOM)

- **Input:** the file URI of the page just photographed, its original pixel dimensions, and
  a `maxLongEdge` (default 2048).
- **Downscale, then map back exactly.** Recognition runs on a copy scaled so the long edge is
  ≤ 2048 px (a 40-line thermal docket lands at ~30 px line height, comfortably above ML Kit's
  16 px per-character guidance **[verified]**). Every box is multiplied back by the exact scale
  factor so `Box` is in **original page pixels**, as `docdom.ts` rule 1 demands. `Page.restoration`
  records `['downscale']`; `Page.transform` is omitted because the boxes are already mapped.
- **Orientation is the bug to write the test for.** Vision reports normalised, bottom-left-origin
  rectangles in the orientation you tell it; ML Kit applied to a file URI rotates by EXIF and
  reports boxes in the rotated frame. The module must produce boxes on the pixel grid of the
  **stored original as the server sees it**, and the acceptance test is visual: the highlights land
  on the digits in the review overlay on both platforms, for a portrait and a landscape shot.
- **Structure:** ML Kit `TextBlock` → `Block` (`kind: 'unknown'`, raster order), `Line` → `Line`,
  `Element` → `Span` with the element's confidence. Vision has no blocks: one `Block` per page,
  one `Line` per observation, spans by splitting the top candidate on whitespace with
  `boundingBox(for:)` per word range, confidence = the candidate's confidence on every span.
  `calibrated: false` on everything.
- **Abstention:** platform OCR does not report unreadable regions, so `unreadable: []`; low
  confidence is carried on the span and the structurer decides what to show (§6.3).
- **Engine ids:** `device-vision`, `device-mlkit`. Version string alongside (`iOS 17.6`,
  `play-services-mlkit-text-recognition 19.x`), because the reading changes when the OS does and
  a disagreement trend has to be attributable.

### 3.4 The structurer (`@snap/docai-preview`)

Header fields only in Stage 1, using the `locked_fields` path vocabulary so the same names flow
through grounding, corrections and locks:

| Path | Rule (deterministic) | Abstains when |
|---|---|---|
| `header.supplier_abn` | Eleven digits allowing spaces, preferring a line containing `ABN`; **must pass mod-89** | No candidate passes the checksum — a hallucinated ABN is unrepresentable |
| `header.payable_amount` | Money pattern on a line carrying TOTAL / AMOUNT DUE / BALANCE / EFTPOS / VISA / MASTERCARD / CASH, excluding SUBTOTAL / GST / CHANGE / SAVINGS; ties → the lowest line on the page | No keyword line has an amount. (No "largest number on the page" fallback: that is a guess) |
| `header.tax_amount` | Money on a line carrying GST / TAX (not "TAX INVOICE") | Not printed. **Never computed as 1/11** — the preview may not produce a figure the paper does not carry |
| `header.issue_date` | Day-first patterns (`dd/mm/yy`, `dd/mm/yyyy`, `dd-mm-yy`, `dd Mon yyyy`); must pass the same window `EditFields.dateProblem` and `validators.ts` apply; day/month ambiguity flagged, not resolved | Outside the window, or unparseable |
| `header.says_tax_invoice` | `TAX INVOICE` present, whitespace- and case-insensitive | — (boolean; false is a real answer) |
| `header.supplier` | Largest-type line (box height) in the top 20% of the page that is not an address, phone, URL or the ABN line | Nothing qualifies |

Output is `Record<path, GroundedField>` — the existing type from `grounding.ts`: `value`,
`spanIds`, `box`, `page`, `confidence` (the **weakest** supporting span, per `weakest()`),
`engine`, `grounded: true`. Grounded by construction, which is the point: a preview field can be
*wrong* (it pointed at the wrong span), but it cannot be *invented*, and wrong-by-pointing is
checkable by anyone with the overlay.

### 3.5 The intake endpoint

```
POST /v1/captures/:captureId/device-reading        Idempotency-Key required
{
  engine: 'device-vision' | 'device-mlkit',
  engineVersion: string,
  docdom: Document,                                  // DocDOM 1.0.0, ≤ 256 KB per page
  preview: Record<path, GroundedField>,
  timings: { recogniseMs: number; structureMs: number },
  device: { platform: 'ios' | 'android'; osVersion: string; model?: string }
}
→ 202 { layoutId }
```

Rules, each with a test that asserts the refusal:

1. Runs as the calling user's own membership (`withTenantAs`), the same way every other write
   does; RLS on `document_layouts` and `document_field_grounding` is already in place (0019, 0020).
2. Writes **only** a `document_layouts` row (`engine_ids = ['device-…']`, `shadow = true`,
   `extraction_run_id = NULL`) and grounding rows (`enforced = false`). It cannot write
   `documents`, `extraction_runs` or `review_tasks`. A test deletes the guard and watches it fail.
3. Payload over the size cap → 413. A DocDOM without `version: '1.0.0'` → 422. A box outside the
   page → 422 (a coordinate bug should fail loudly at the seam).
4. Never blocks or reorders extraction; the worker does not read device layouts in Stage 1.
5. Store the JSON at `${tenant}/layouts/${captureId}/device-${uuid}.json` beside the shadow
   layouts, so `latestLayout` semantics and the retention job are unchanged.

**A deliberate revision of `docs/OCR.md` §4.9's storage sentence.** §4.9 says the device
reading *"is stored as an extraction run with `engine = 'device'`"*. It should be stored as a
**layout**, not a run: an `extraction_runs` row is the thing `documents.current_run_id` can point
at, and keeping the device out of that table makes "the preview may never post" a property of the
schema rather than of discipline. D32's intent — advisory, provenance-tagged, comparable to the
server's read — is fully served by `document_layouts.engine_ids`. The `extraction_engine` enum
(`claude_vision`, `claude_text`, `ocr_llm`, `manual`, `import` **[verified]** migration 0001) is
left alone. Recorded as D38 below.

### 3.6 Registry entries

```ts
// design sketch — packages/docai-preview/src/engines.ts
{ id: 'device-vision', capabilities: ['detect','recognise'], residency: 'in-process',
  requiresNetwork: false, weightsLicence: 'none', redistributable: true, tier: 1, medianSeconds: null,
  note: 'Apple Vision VNRecognizeTextRequest, iOS 13+. An OS framework: we ship no weights. Preview only; never routed by the server.' }

{ id: 'device-mlkit', capabilities: ['detect','recognise'], residency: 'in-process',
  requiresNetwork: false, weightsLicence: 'none', redistributable: true, tier: 1, medianSeconds: null,
  note: 'Google ML Kit Text Recognition v2, Latin, UNBUNDLED: model delivered by Google Play services, not in our APK. SDK is proprietary (ML Kit Terms, 2025-05-14) and reports usage metrics to Google — disclosed in the privacy notice. Preview only.' }
```

`weightsLicence: 'none'` is the value `pdf-text` uses, with the same meaning: *there is nothing
of ours whose licence could violate the floor.* If anyone ever switches to the **bundled** ML Kit
artefact, the value becomes `'proprietary'` and `violatesLicenceFloor()` fails the build — which
is exactly what D23 is for, applied to the APK (§5).

---

## 4. Runtime and integration cost in Expo SDK 57

The app is Expo SDK 57 / React Native 0.86 **[verified]** `package.json`; SDK 57 requires iOS
16.4+ and Android 7+ **[verified]** Expo docs. It is a managed (CNG) app: no `android/` or
`ios/` directory is committed, `expo prebuild --platform android` passes, and `docs/BUILD.md`
already routes device builds through `expo run:*` / EAS **[verified]**.

| Runtime | What it is | Expo story | Cost to us | Fit |
|---|---|---|---|---|
| **Local Expo module (Vision / ML Kit)** — recommended | Swift + Kotlin in `modules/snap-ocr/`, autolinked during prebuild **[verified]** Expo docs | No ejection; `prebuild` still passes; **a development build is required — Expo Go cannot run custom native code** **[verified]** Expo docs: *"If you are using Expo Go, you can only access native libraries that are included in the Expo SDK"* | ~2–4 days for the module on both platforms; the orientation test is most of it **[estimate]** | The only option that adds 0 MB of weights |
| `@react-native-ml-kit/text-recognition` (community) | ML Kit on both platforms | Autolinks; same dev-build requirement | Saves a day on Android; **costs ~38 MB on iOS** (statically linked ML Kit model) **[verified]** and adds Google's SDK to the iPhone for no reason when Vision is free | Not chosen |
| **`onnxruntime-react-native`** (Microsoft, for shape (c)) | ONNX Runtime with an **Expo config plugin** — add `"onnxruntime-react-native"` to `plugins`, run `npx expo prebuild` **[verified]** package README; supports ONNX and ORT formats | Stays managed | Weights are 2–20 MB; the pre/post-processing is the work (§2.4) | Stage 3 |
| `react-native-executorch` (Software Mansion) | ExecuTorch; LLMs, and since v0.8.0 VLMs via `useLLM` with `capabilities: ['vision']` (LFM2-VL-1.6B) **[verified]** release notes; OCR hooks exist | **"Expo SDK 55+ with Development Builds (Expo Go is not supported due to custom C++ native libraries)"**, RN 0.83+, iOS 17.0+ **[verified]** README | Compatible with our SDK; per-model memory tables not retrievable (docs 404 at the time of writing) | The runtime for a Stage 3 VLM re-test; not for Stage 1 |
| `llama.rn` (llama.cpp) | GGUF inference incl. multimodal via mmproj; MIT; Metal on iOS, OpenCL on Adreno **[verified]** README | Expo via `expo-build-properties`; New Architecture required from v0.10 **[verified]** | Model download 1.7–2.6 GB on first run | Same |
| MediaPipe LLM Inference (LiteRT-LM) | Gemma 3n / Gemma 4 E2B–E4B, multimodal **[verified]** | **No React Native or Expo integration is documented** — Google's guide names Android, iOS, web and desktop only, so a bridge would be ours to write **[verified]** | Plus the device class problem (§2.2) | Not now |
| MLC (`react-native-ai`) | GPU-first LLM engine | Native build | Same device-class problem | Not now |
| Core ML directly | Apple only | Local module | Stage 3 (D36, GAPS D2) if Vision proves insufficient | Later |

**The one cost that must be named plainly.** Once a native module is in the app, **the Expo Go
demo path in `apps/mobile/README.md` ("Expo Go on a real iPhone — 2 min") stops carrying the
preview.** Two mitigations, both required: the module is feature-detected so Expo Go still
captures exactly as today (the preview simply does not appear), and the demo build becomes an
EAS `preview` APK / TestFlight build — which `docs/BUILD.md` already says is the build to demo
with. Nothing else about the managed workflow changes: no ejection, `prebuild` still generates the
native projects, OTA updates still ship the JS (the structurer included), and only the native
recogniser waits for a store release — the seam §4.9 warned about, and here it is a two-file module.

---

## 5. Licence position

D23: only Apache-2.0 or MIT weights in a redistributable image, enforced in CI. An APK is a
redistributable image.

| Component | Licence, as read | Enters our APK/IPA? | D23 | Notes |
|---|---|---|---|---|
| Apple Vision | Apple OS framework | No (part of iOS) | Not in scope — no weights of ours | Zero third-party SDK on the iPhone, which also honours D25's "no third-party SDK next to financial records" |
| ML Kit Text Recognition v2, **unbundled** | Google **ML Kit Terms** (proprietary; last modified 14 May 2025; no reverse engineering) **[verified]** | SDK stub ~260 KB yes; **model no** (Google Play services) **[verified]** | Passes as written — no weights of ours in the image | **Two things to disclose:** ML Kit "does not send that data and the resultant outputs to Google servers", but *does* transmit performance metrics, and the terms require developers to inform users of Google's processing of ML Kit metrics data **[verified]**. That is a privacy-notice line and an owner decision (§12 Q1). Devices without Google Play services cannot use it — fall back to server-only |
| ML Kit, **bundled** | Same terms | **Yes, ~4 MB per script per architecture** **[verified]** | **Fails** — proprietary weights in the image | Not chosen; the registry value `'proprietary'` would fail CI |
| PP-OCRv5 / v6 mobile weights (Stage 3) | **Apache-2.0** **[verified]** PaddleOCR | Yes | Passes | The route that removes Google from Android entirely |
| Florence-2-base (Stage 3 experiment) | **MIT** **[verified]** | Yes | Passes | |
| Gemma 4 E2B (Stage 3 re-test) | **Apache-2.0** **[verified]** | Yes (2.58 GB) | Passes | Fails the budget, not the floor |
| Gemma 3n, LFM2-VL, Chandra, Surya, Nanonets | Gemma Terms / LFM Open License / OpenRAIL / OpenRAIL / none | — | **Fail** | Gemma Terms require passing the Prohibited Use Policy downstream **[verified]**; the others per `docs/OCR.md` §2 |
| SmolDocling | CDLA-Permissive-2.0 **[verified]** | — | **Fails as D23 is written**, though permissive | Needs a ruling if ever wanted; not for a phone anyway |

**Enforcement.** `violatesLicenceFloor()` exists in `packages/docai/src/registry.ts` and is
exercised only by `pipeline.test.ts` **[verified]** — CI runs the boundaries test but nothing
runs the floor against a *build*. The device engine declarations live in `@snap/docai-preview`,
so the same function can be run against them in the workspace test suite; add it, and add the
rule that the mobile build must not contain a text-recognition model artefact (a check on the
`prebuild` output for `com.google.mlkit:text-recognition*` bundled artefacts versus
`play-services-mlkit-text-recognition`). Cheap, and it makes the "unbundled" decision a control
rather than a sentence.

---

## 6. What "good enough for a preview" means, and how it is measured

### 6.1 What the preview is for

It exists so that the person sees plausible fields immediately and **corrects fewer of them than
they would type into a blank form** — while never being shown a number that is wrong often enough
to teach them to distrust the screen. Those are two different quantities and the second is the
one that can embarrass a demo.

### 6.2 The metrics — reusing `docs/GAPS.md`'s discipline, not inventing a parallel one

`apps/server/bench/scoring.py` already scores each field as EXACT / NORMALISED / WRONG / MISS /
ABSTAIN_OK / HALLUCINATED against a committed per-field ground truth, and B4 derives
`corrections per 100 documents = (WRONG + MISS + HALLUCINATED) per document × 100`
**[verified]**. The preview is scored by the same script on the same manifest, with three derived
columns:

| Metric | Definition (per field, over the gold set) | Why it matters |
|---|---|---|
| **Fill rate** | shown / (truth non-null) | A preview that is mostly blank saves nobody anything |
| **Wrong-when-shown** | (WRONG + HALLUCINATED) / shown | **The trust metric.** A shown value a person reads and believes |
| **Preview corrections per 100** | B4's formula, on the preview's output | Directly comparable with the server engines and, after E2, with Hubdoc and Dext |
| **Blank-form baseline** | every truth-non-null field = one correction; ≈ 500–600 per 100 documents on the six header fields | The bar the preview has to beat by a margin, not just clear |

### 6.3 The bar for shipping Stage 1 to users — proposed now, measured in Stage 0

| Field group | Fill rate | Wrong-when-shown | Basis |
|---|---|---|---|
| Money: `payable_amount`, `tax_amount` | ≥ 70% | **≤ 3%** | **[estimate]** — a total the user reads and then confirms is the most expensive wrong number in the product |
| `supplier_abn` | ≥ 60% | ≤ 1% (mod-89 already makes an invented ABN impossible; what remains is a one-digit misread that happens to pass — rare, but not zero) | |
| `issue_date` | ≥ 70% | ≤ 5% | Day/month ambiguity is flagged, not scored as wrong |
| `supplier`, `says_tax_invoice` | ≥ 60% | ≤ 10% | Text; cheap to fix; shown as provisional |
| **Whole preview** | — | **≥ 50% fewer corrections per 100 than the blank-form baseline** | The reason it exists |

**The show/hide threshold is chosen from the measured coverage–risk curve** — for each field,
the span-confidence cut-off at which wrong-when-shown stays under the ceiling on the gold set is
the threshold shipped. That is D20's method applied to a binary decision, and it is how the
preview respects D37 without waiting for full calibration: the read-only preview *nags nobody*
(blank is its abstention), so it can ship on a gold-set-derived threshold, while the **live
quality gate** ("I cannot read the total — retake") stays behind B3 exactly as D37 says. Recorded
as D40 below, because it resequences GAPS Lane D.

### 6.4 How the measurement is run

1. **Gold set:** `au-receipts` from GAPS B1 (≥ 40 real documents, per-field truth committed, null
   truths scored as abstention). **Nothing in §6 is measurable before B1 exists.** The four
   synthetic fixtures in `manifest.json` exercise the structurer's unit tests only.
2. **Device matrix** (OCR.md §8.2): the gold-set images are recognised **on the floor devices** —
   Galaxy A16 5G (4 GB) and iPhone 11 or 12 — by a developer screen in the dev build that runs
   `snap-ocr` over a folder of images and exports one DocDOM per document, with timings and peak
   memory from the platform profilers. These DocDOMs are committed under
   `bench/corpus/device/<engine>/<device>/` like any other engine output.
3. **Scoring:** `preview_score.py` runs `structure()` (via a tiny Node shim, so it is the same TS
   code the app ships) over each DocDOM and scores with `scoring.py`. It also runs the server
   sidecar's DocDOM for the same documents through the same structurer, which separates *the
   recogniser's* error from *the structurer's*.
4. **In production, without a gold set:** because the device reading is uploaded, the server can
   compute **preview–server agreement per field** for every capture — the §4.9 "free disagreement
   signal". It is the metric that keeps running after launch, per engine version and per device
   model, and it is what tells us when an OS update changed the reading.

---

## 7. Reconciliation: the preview meets the record

### 7.1 The rule

**Nothing a person has read changes silently.** The preview is painted in the provisional style
(dashed underline, "Provisional" chip in `scan` cyan — the capture/extraction signature colour
`docs/DESIGN-HANDOFF.md` reserves for exactly this, never `good`, never `risk`). When the server's
document arrives, each field resolves by one of four transitions, and every transition that
changes a visible value leaves a visible trace.

| Preview | Person | Server | What the screen does | Copy |
|---|---|---|---|---|
| `$48.50` | untouched | `$48.50` | Value stays; provisional style drops; a small "read twice" tick | *"Confirmed by two independent reads."* |
| `$48.50` | untouched | `$46.50` | **Server value replaces it, with a chip that stays until dismissed or the field is tapped** | *"Preview read $48.50 · server read $46.50 — check the docket."* Tapping shows both highlighted on the image |
| `$48.50` | untouched | `null` | Field goes blank; the preview value becomes a **one-tap suggestion** | *"The server could not confirm a total. Preview read $48.50 — use it?"* Accepting is a human correction and locks the field |
| `null` | untouched | `$48.50` | Value appears; provisional style never applied | — |
| any | **edited** (Stage 2) | anything | **The person's value wins and is posted as a correction as soon as the document exists**; if the server disagrees it is shown as a note, never applied | *"Server read $46.50; you entered $48.50. Keeping yours."* with a "use server's" action — a human act, so allowed |

**Confirm-and-post is disabled until the server's document exists**, with the reason on screen:
*"Waiting for the server's read before this can post to the ledger."* Offline, that is a truthful
state, not an error: the capture is stored, the preview is on screen, and the confirm button waits
for signal. The preview never posts, never sets `is_tax_invoice`, never produces a BAS figure —
these are not disabled affordances, they are code paths that do not exist on the preview screen.

### 7.2 Does `documents.locked_fields` apply?

**Yes — it is the right mechanism, and it needs no change.** `locked_fields` records the paths a
human has settled; `repo.ts` unions the touched paths on every correction and, on re-extraction,
keeps a locked column's value and reports the contest instead of overwriting **[verified]**
`repo.ts` `updateDocument` / `saveExtraction`, trigger in migration 0009. A preview edit is a
human edit made *earlier in time*, so the design is simply to deliver it as a correction:

- **Stage 1** has no editing on the provisional screen, so nothing to reconcile: the person edits
  after the server's read exactly as today.
- **Stage 2** adds editing before the document exists. The edit is queued in the existing outbox
  (`api/outbox.ts`: durable, idempotency-keyed, workspace-scoped **[verified]**) as
  `PATCH /v1/captures/:captureId/document { edits, previewEngine }`. The server resolves the
  capture's document; if extraction has not produced one yet it answers **409 `document_not_ready`**
  and the outbox retries with its existing back-off. When it applies, `updateDocument` locks the
  touched paths as it already does, and any later machine run — including the very first one if
  the correction somehow lands after it — is subject to the lock. The ordering hazard (correction
  arriving before the document exists) is handled by the 409, not by a race; the test for it is a
  correction queued offline, replayed against a capture whose extraction is deliberately delayed.

What `locked_fields` does **not** cover, and what the preview must not pretend it does: a preview
value the person merely *looked at* is not a lock. Only an edit or a confirmation is. That is why
the untouched-but-different row in §7.1 replaces the value (visibly) rather than keeping it.

### 7.3 Multi-page and multi-device

A two-page invoice produces one DocDOM with two `pages`; the structurer prefers the last page
for totals (the GST summary is on page 2, as Phase 0 found). Two people photographing the same
paper on two devices produce two device layouts on the same capture — allowed, like shadow
layouts; the review screen shows only the reading from *this* device and the server's record.

---

## 8. Staged plan — the first stage is small and provable

| Stage | Builds | Gate to pass | Depends on |
|---|---|---|---|
| **0 — Measure** (1–2 weeks) | `snap-ocr` local module on both platforms (recognise-only, no UI); a dev-build screen that runs it over a folder of images and exports DocDOM + timings + peak memory; `preview_score.py`; `@snap/docai-preview` structurer with unit tests on the synthetic fixtures | **Numbers on the floor devices** for §1.3 and §6.3, on the `au-receipts` gold set, both engines. The Stage 1 go/no-go is these numbers, per platform | **GAPS B1** (the gold set). Two floor devices in hand |
| **1 — Read-only provisional preview** (2–3 weeks after the gate) | Preview on the capture → review flow; provisional visual language; confirm disabled until the record; device-reading upload endpoint with the negative tests; boundaries and licence-floor amendments; feature detection for Expo Go/web; privacy-notice line for ML Kit metrics | On the device matrix: wrong-when-shown under §6.3 ceilings, p90 time-to-first-field ≤ 3 s, peak RAM ≤ 60 MB, `prebuild` and EAS `preview` build pass, Expo Go still captures. Ship per platform as each passes — iOS is expected to pass first (D36) | Stage 0 gate |
| **2 — Offline editing and agreement** | `PATCH /v1/captures/:id/document` with 409-not-ready; outbox integration; agreement chips from the uploaded reading (advisory finding, `severity: 'note'`); `legibilityScore` finally carrying a checked number; the **live quality gate** (frame-rate detection while framing — `react-native-vision-camera` frame processors or periodic stills) | Agreement rate on `payable_amount` ≥ 80% in production over 30 days; the quality gate fires on "cannot read the total", not "looks blurry" | **GAPS B3 / D37** for the quality gate. Stage 1 in the field |
| **3 — Own weights, and the VLM re-test** | (a) PP-OCRv6 `tiny`/`small` via `onnxruntime-react-native` on Android (removes Google's SDK and telemetry) and Core ML on iOS if Vision's measured gap justifies it — GAPS D2/D3; (b) a **Gemma 4 E2B** and **Florence-2-base** spike on the floor devices with time-to-first-field and peak memory recorded, to keep the "why not a VLM" answer current | Adopt only on a measured win on the same gold set; the VLM re-test is a result either way | Stage 1 numbers to beat |

**What this changes in `docs/GAPS.md`.** Lane D currently depends on G3 (calibration) in full.
This plan splits it: the *read-only preview* depends on **B1** (the gold set) and ships on a
gold-set-derived show/hide threshold; the *quality gate* keeps its dependency on **B3**. D37's
reasoning — an uncalibrated nag fails both ways — is about the gate, and the read-only preview
does not nag. Lane D1 (relax the boundaries rule) is executed as written, with the named exception
being `@snap/docai-preview` rather than a runtime. Lane D2's "iOS / Core ML first" becomes "iOS /
Vision first; Core ML only if measured" — the cheaper form of the same decision.

**What this does for D27's margin case.** Nothing in Stage 1 makes a scan cheaper: the server
still runs its full extraction. The lever ECOSYSTEM D27 hopes for — a cheaper server pass when
the preview is good — becomes possible in Stage 2 because the uploaded device reading is a second,
architecturally different reader the server gets for free: where it agrees with the server's T1
OCR + structurer and the validators pass, the VLM tier can be skipped. That is GAPS C3's routing
plan with one more input; **it is not a number yet, and it must not appear on a slide as one.**

---

## 9. What would make us abandon the approach

Each is a measured condition, not a feeling:

1. **Recall.** On the `au-receipts` gold set, either platform's recogniser finds the printed
   total on fewer than 70% of documents after the downscale rule is tuned once. A mostly blank
   preview is not a preview; for that platform, either move to Stage 3 (own weights) immediately
   or ship server-only.
2. **Trust.** Wrong-when-shown on `payable_amount` or `tax_amount` stays above 3% after two
   tuning iterations of the structurer. Then hide money and show only ABN, date, supplier — or
   pull the preview. A preview that is wrong one time in twenty on the total teaches the user to
   read the server's number anyway, and has cost us the trust the pitch depends on.
3. **Latency.** p90 time-to-first-field above 5 s on the floor device. At that point the server's
   read is arriving anyway and the preview is a spinner with a name.
4. **Memory.** Peak added RAM above 150 MB, or any reproducible foreground kill on the 4 GB
   Android during capture. The capture is the product; the preview is not allowed to cost one.
5. **Agreement drift.** Production preview–server agreement on the total below 80% for a device
   model or OS version, sustained a month. Disable the preview for that segment (remotely, via the
   structurer's OTA-shipped configuration) and investigate.
6. **Integration.** The local module breaks `expo prebuild` or EAS builds in a way not fixed
   within a week, or forces an ejection. The managed workflow is worth more than the preview.
7. **Terms.** Google changes ML Kit's terms or telemetry in a way the privacy notice cannot
   honestly carry. Then Android goes straight to Stage 3(a) or server-only.

And the condition under which the **VLM answer flips**: a licence-clean model that, on the Galaxy
A16 5G, produces header fields in under 5 s at under 400 MB of added memory *and* can be grounded
to spans. None exists today. Stage 3(b) re-asks the question once a year, with the same harness.

---

## 10. What was verified, what is cited, what is estimated

**Verified (primary source read during this research):**
Apple Vision `VNRecognizeTextRequest` availability (iOS 13.0+), `VNRecognizedText.confidence`,
`boundingBox(for:)`, `RecognizeDocumentsRequest` (iOS 26.0+, receipts/forms, tables and lists) —
Apple developer documentation · ML Kit Text Recognition v2 Android: API 23+, bundled "about 4 MB
per script per architecture", unbundled "about 260 KB", blocks/lines/elements/symbols with boxes
and confidence, 16–24 px character guidance, "real-time on most devices for Latin" · ML Kit iOS:
"about 38 MB per script SDK", statically linked · ML Kit Terms (14 May 2025): proprietary, no
reverse engineering, on-device inference, metrics transmitted to Google, disclosure requirement ·
Gemma Terms of Use (custom, downstream restrictions) and Gemma 4 Apache-2.0 (LiteRT-LM page, Open
Source blog) · Gemma 4 E2B LiteRT-LM: 2.58 GB file, S26 Ultra CPU 557/46.9 tok/s and 1,733 MB,
iPhone 17 Pro CPU 532/25.0 tok/s, vision "loaded on demand" · Gemma 3n E2B: 3.14 GB `.task`,
"dynamic memory footprint of just 2GB" · MediaPipe LLM Inference: "optimized for high-end Android
devices, such as Pixel 8 and Samsung S23 or later", no RN/Expo integration · Qwen2-VL-2B
Apache-2.0 and GGUF sizes; Qwen3-VL-2B Apache-2.0; InternVL3-1B MIT; Moondream2 Apache-2.0;
SmolVLM-256M Apache-2.0, "<1GB of GPU RAM", DocVQA 58.3, OCRBench 52.6; LFM2-VL-450M LFM Open
License; Florence-2-base MIT with `<OCR_WITH_REGION>`; SmolDocling CDLA-Permissive-2.0;
PaddleOCR-VL Apache-2.0; dots.ocr MIT; DeepSeek-OCR MIT; GOT-OCR2.0 Apache-2.0 · PaddleOCR
model tables (PP-OCRv5 mobile det 4.7 MB / rec 16 MB; PP-OCRv6 tiny/small/medium det 1.9/9.6/59.4
MB, medium rec 73.3 MB; T4/Xeon footnote) and the PP-OCRv6 page · `onnxruntime-react-native`
Expo config plugin · `react-native-executorch` README (Expo 55+, dev builds only, iOS 17+) and
v0.8.0 VLM support · `llama.rn` multimodal, Expo via `expo-build-properties`, MIT · Expo:
local modules (`create-expo-module --local`, Swift/Kotlin, autolinked), Expo Go limitation, SDK 57
iOS 16.4+/Android 7+ · Apple Intelligence device list (iPhone 15 Pro and later) · ML Kit GenAI
device gating · Samsung AU Galaxy A16 5G 4 GB/128 GB; GSMArena variants and SoC · iPhone RAM by
model (Wikipedia model tables) · Statcounter AU OS and vendor share, August 2026 · Telsyte
17 Aug 2026 release · Android memory-management documentation (LMK, `oom_adj_score`) · **Our
code:** no ML Kit/Vision dependency in `apps/mobile/package.json`; `capture.tsx`'s static
pre-flight copy and its "no on-device legibility measurement exists" comment; `registry.ts`
`EngineSpec` and `violatesLicenceFloor()` (used only in `pipeline.test.ts`); `docdom.ts`;
`grounding.ts`'s `GroundedField`; `pipeline.ts`; `shadow.ts`'s use of `saveLayout` /
`saveFieldGrounding`; migrations 0001 (`extraction_engine` enum), 0003 (`legibility_score`,
`device_meta`), 0009 (lock trigger), 0019, 0020; `repo.ts` lock union and re-extraction contest;
`documents.controller.ts` `version` → 409; `outbox.ts`; `http.ts` `awaitExtraction` polling;
`test/boundaries.test.ts`; `bench/scoring.py`; `bench/manifest.json`; `ci.yml`.

**Cited (a third party's measurement, not reproduced):** Qwen2-VL-2B DocVQA 90.1 / OCRBench 794;
Moondream2 DocVQA 79.3; LFM2-VL OCRBench 657; PaddleOCR accuracy figures and the M4 speed claim;
Telsyte's market figures; Statcounter's shares; iOS 26 supporting iPhone 11 and later (tech
press, not Apple's own page); the arXiv 2410.03613 statement about effective available memory.

**Estimated (my arithmetic or judgement — replace with Stage 0 measurements):** every figure in
§1.3's targets; foreground memory available on a 4 GB Android (1.5–2 GB); the OCR bitmap size
(12.6 MB); Gemma 4 E2B time-to-first-field on the floor device (20–45 s) and its image token
count; the 5–10× CPU gap between an S26 Ultra and a Dimensity 6300; Qwen2-VL-2B's runtime memory
(~2.5 GB); a 0.5B structuring LLM's memory and latency (400–700 MB, 8–20 s); the module effort
(2–4 days) and the PP-OCR post-processing effort (2–3 weeks); the §6.3 thresholds; the
blank-form baseline (~500–600 corrections per 100).

**Could not be established:** any on-phone latency or memory for any VLM on a mid-range Android
or an A13-class iPhone (every published number is a flagship, a laptop or a Pi); Apple Vision's or
ML Kit's accuracy on thermal dockets (no vendor publishes one — Stage 0 is the first measurement);
Gemma 4 E2B's vision-encoder size and memory; `react-native-executorch`'s per-model memory tables
(documentation paths returned 404); whether Vision's per-word boxes are tight enough on a curled
docket for a highlight to land on the digits (visual test in Stage 0); how `expo-camera` writes
EXIF orientation on both platforms, which decides the coordinate mapping (Stage 0's first test);
the share of AU Android devices without Google Play services (small; server-only fallback covers
it).

---

## 11. Tickets

Tiers and routing per the engineering-army convention. Model·effort is the seat default (Sonnet
for seniors/medior/qa/devops, Haiku for junior) unless flagged. Dependency order is top to bottom
within a stage.

### Stage 0 — measure

**OD-1 · `snap-ocr` local Expo module, recognise-only** — `senior-fe` · **opus·medium**: the work
is small but the orientation/coordinate mapping is a silent-failure class where a cheap first pass
that gets EXIF wrong on one platform costs a full re-run.
*Do:* `apps/mobile/modules/snap-ocr/` with Swift (Vision, `.accurate`, `usesLanguageCorrection`
false so digit strings are not "corrected" into words, English chosen from
`supportedRecognitionLanguages()` — do not hard-code a locale identifier) and Kotlin (ML Kit **unbundled**
`play-services-mlkit-text-recognition`, Latin); `recognise(uri, {maxLongEdge}) → Partial<Document>`
DocDOM-shaped per §3.3; feature-detect export (`isAvailable()`).
*Done when:* on a real Galaxy A16 5G and an iPhone 11/12, a portrait and a landscape photo of the
same docket produce DocDOMs whose boxes, drawn over the **stored original** in a dev screen, land
on the printed digits on both platforms; `npx expo prebuild` passes on both platforms; Expo Go and
web still capture with the module absent; `pnpm -r typecheck` clean.
*Depends on:* two floor devices.

**OD-2 · DocDOM wire types into `@snap/api-contract`; docai re-exports** — `medior` · default.
*Do:* `packages/api-contract/src/docdom.ts` with the types from `packages/docai/src/docdom.ts`
verbatim (no functions, no imports); docai re-exports the types and keeps `spansOf`, `spanIndex`,
`unionBox`, `weakest`; `packages/docai/package.json` gains `@snap/api-contract`.
*Done when:* `test/boundaries.test.ts` "api-contract imports nothing" still passes, all docai tests
pass unchanged, one declaration of `Document` exists in the workspace.

**OD-3 · `@snap/docai-preview` — the deterministic structurer** — `medior` · default.
*Do:* new package, zero runtime dependencies; `structure(doc: Document): Record<path, GroundedField>`
per §3.4; move `grounding.ts`'s `normalise` and `dateRenderings` here and re-export from docai;
engine declarations per §3.6.
*Done when:* unit tests over the four synthetic fixtures' DocDOMs (from the sidecar shadow runs)
produce EXACT/NORMALISED on every non-null header field and ABSTAIN_OK on `receipt-noabn`'s ABN
and GST; a test proves an ABN failing mod-89 comes back null; a test proves `tax_amount` is never
emitted when not printed; `violatesLicenceFloor(deviceEngineSpecs)` returns `[]`.
*Depends on:* OD-2.

**OD-4 · Boundaries and licence-floor amendments** — `junior` · default.
*Do:* `ALLOWED_FOR_MOBILE` gains `@snap/docai-preview` with the reason in the comment; new
assertions: `@snap/docai-preview` has no runtime deps and cannot reach `@snap/db`, `@snap/tax-engine`
or `@snap/docai`; `WORKSPACE_DIRS` updated; a workspace test runs `violatesLicenceFloor` over the
device engine declarations.
*Done when:* `pnpm test:boundaries` passes; temporarily adding `@snap/docai` to the preview
package's dependencies makes it fail.
*Depends on:* OD-3.

**OD-5 · `preview_score.py` and the device-matrix corpus layout** — `qa` · default.
*Do:* per §6.4 steps 2–3: Node shim to run `structure()` over DocDOM JSON; score with
`scoring.py`; report fill rate, wrong-when-shown, preview corrections per 100, blank-form baseline,
and a per-engine timing/memory table read from the dev screen's export; corpus layout
`bench/corpus/device/<engine>/<device>/`.
*Done when:* running it over the sidecar's DocDOMs for the synthetic fixtures produces a results
markdown with every column populated, and "not run" for engines with no corpus.
*Depends on:* OD-3.

**OD-6 · Stage 0 measurement run** — `qa` · default.
*Do:* recognise the `au-receipts` gold set on both floor devices via OD-1's dev screen; commit the
DocDOMs and timings; run OD-5; record the §1.3 and §6.3 numbers in this document's §10 as
**measured**.
*Done when:* this document has a measured row for every target in §1.3 and every ceiling in §6.3,
per platform, with the run id — and a go/no-go per platform written under it.
*Depends on:* OD-1, OD-5, **GAPS B1**.

### Stage 1 — read-only preview (only for platforms that passed OD-6)

**OD-7 · `POST /v1/captures/:id/device-reading`** — `senior-be` · default.
*Do:* per §3.5 with `withTenantAs`, `saveLayout`, `saveFieldGrounding`; size and shape validation;
idempotency via the existing `Idempotency-Key` mechanism; OpenAPI from the DTO.
*Done when:* e2e as `app_rw` (never a bypass role): a valid reading yields one `document_layouts`
row with `shadow = true`, `extraction_run_id IS NULL`, `engine_ids = ['device-vision']` and the
grounding rows; a reading for another tenant's capture is refused by the database; a 300 KB page
→ 413; a box outside the page → 422; **`documents`, `extraction_runs` and `review_tasks` row counts
are unchanged before and after** — and the test is verified by making the handler write a review
task and watching it fail.
*Depends on:* OD-2.

**OD-8 · Provisional preview in the capture → review flow** — `senior-fe` · default; `senior-uiux`
reviews the provisional visual language.
*Do:* after `shoot()`, run `snap-ocr` + `structure()` and navigate to the review screen in
provisional mode while upload and extraction proceed; provisional style per §7.1 (`scan` cyan,
dashed underline, "Provisional" chip); confirm disabled with the §7.1 copy; `EditFields` hidden in
provisional mode; on `awaitExtraction` resolving, apply the §7.1 transitions with the chips; upload
the reading via OD-7 (fire-and-forget through the outbox so an offline capture still records it
later).
*Done when:* driven on both floor devices: fields appear before the upload completes; the four
untouched transitions in §7.1 each render their copy (forced with a fixture server); confirm is
unreachable until the document exists; with the module absent the flow is byte-for-byte today's;
no console errors; both themes.
*Depends on:* OD-3, OD-7.

**OD-9 · Privacy notice and README updates** — `junior` · default.
*Do:* the ML Kit metrics disclosure line (§5) in the privacy notice and `docs/WEB.md`'s legal
surface; `apps/mobile/README.md` demo section updated for dev builds; `docs/BUILD.md` note that the
preview requires an EAS/dev build.
*Done when:* the notice names Google ML Kit, says images never leave the device via it, and that
usage metrics are sent to Google; README no longer promises the preview in Expo Go.
*Depends on:* owner decision §12 Q1.

**OD-10 · Stage 1 device-matrix acceptance** — `qa` · default.
*Done when:* on each shipped platform's floor device: p50/p90 time-to-first-field, peak added RAM
and cold start recorded against §1.3; wrong-when-shown from OD-6 re-run on the shipped threshold;
EAS `preview` build installs and runs; the abandon conditions in §9 all evaluated and written down.
*Depends on:* OD-8.

### Stage 2 — editing and agreement (specified now, scheduled after Stage 1 is in the field)

**OD-11 · `PATCH /v1/captures/:id/document` with 409-not-ready; outbox integration** —
`senior-be` · **opus·medium**: the ordering hazard (corrections replayed against a capture whose
extraction has not run, has run, or ran twice) and idempotency across retries are where a first
implementation quietly loses a human edit.
*Done when:* a correction queued offline against a not-yet-extracted capture is 409'd, retried by
the outbox, applied once after extraction, locks the path, and a subsequent re-extraction contests
rather than overwrites it — asserted on real Postgres.

**OD-12 · Agreement findings** — `medior` · default.
*Do:* the worker (post-extraction, shadow-style, never throwing into the real path) compares the
capture's latest device layout's preview fields with the extraction's values and emits
`severity: 'note'` findings for disagreements; `DocumentView.findings` carries them.
*Done when:* a forced disagreement appears as a note with both values; agreement rate per field is
queryable per engine version and device model.

**OD-13 · Live quality gate** — `senior-fe` · default. Gated on **GAPS B3**.
*Done when:* the gate fires on "cannot read the total" on a real docket on a real floor device with
a calibrated threshold, and a phone that cannot run it captures exactly as today.

### Stage 3 — own weights and the VLM re-test

**OD-14 · PP-OCRv6 tiny/small via `onnxruntime-react-native` (Android)** — `senior-integrator` ·
**opus·medium**: DB post-processing, crop-and-warp and CTC decode in native code with exact
coordinate mapping is non-obvious, multi-file work where a wrong first cut is a full redo.
*Done when:* on the Galaxy A16 5G, `device-ppocr` beats `device-mlkit` on OD-5's metrics on the
same gold set, within §1.3, or the ticket is closed with the measured reason.

**OD-15 · Gemma 4 E2B and Florence-2-base floor-device spike** — `medior` · default.
*Done when:* time-to-first-field, peak memory and first-run download recorded on both floor
devices via `react-native-executorch` or `llama.rn`, and §2.2 updated with measured rows — a
result either way.

### Housekeeping

**OD-16 · Decision numbering collision** — `junior` · default.
`docs/ECOSYSTEM.md` numbers its decisions D24–D27 "on from `docs/OCR.md`", but OCR.md already
holds D24–D28 (digital twin, append-only edits, never redraw, field-is-a-pointer, certified vs
working copy) and runs to D37. Renumber ECOSYSTEM's to D38+ or prefix them (`E1–E4`) and add a
cross-reference; this document numbers on from OCR.md's D37 and would otherwise collide too.
*Done when:* every decision id in `docs/` is unique and `grep -n "D24" docs/*.md` points at one
decision.

---

## 12. Open questions for the owner

| # | Question | Recommendation, and what changes if you decide otherwise |
|---|---|---|
| **Q1** | **Accept Google's proprietary ML Kit SDK on Android for Stage 1**, with its usage-metrics telemetry disclosed in the privacy notice, or go straight to our own PP-OCR weights (Stage 3a) and ship the Android preview weeks later? | Accept for Stage 1: the model is not in our APK, no image data leaves the device, the disclosure is one sentence, and it lets Android be *measured* in Stage 0 rather than assumed. If you refuse: Android waits for OD-14; iOS proceeds unchanged |
| **Q2** | Should the preview ever **compute** GST as 1/11 of the total when GST is not printed? | No. The rule "the preview may never produce a figure the paper does not carry" is worth more than a filled field, and mixed GST-free dockets make the arithmetic wrong exactly when the user would not notice. `EditFields` already derives it on the server's record, after review |
| **Q3** | Is uploading the device reading (text + boxes + device model/OS) acceptable without a new consent step? | Yes: it is a derivative of the image the user is already uploading, stored under the same tenant and RLS, and `device` metadata is limited to platform, OS version and model. If you want it opt-in, Stage 1's upload becomes a setting defaulting on, and §6.4 step 4's production metric shrinks to the consenting population |
| **Q4** | Losing the Expo Go demo path for the preview — acceptable? | Yes, with feature detection so Expo Go still captures; `docs/BUILD.md` already says demo with the EAS `preview` build |
| **Q5** | Ship iOS-only first (D36) if Android fails its Stage 0 gate, or hold both? | Ship whichever passes; do not hold iOS for Android. The gates are per platform by design |
| **Q6** | Agree the two documented revisions: store the device reading as a **layout, not an extraction run** (§3.5), and split Lane D's dependency so the **read-only preview depends on B1 while the quality gate keeps B3** (§6.3, §8)? | Both recommended; both recorded below as decisions pending your nod |

---

## 13. Decisions (numbered on from `docs/OCR.md` D37 — see OD-16 on the collision)

| # | Decision | Why |
|---|---|---|
| **D38** | **The on-device reader is platform OCR plus a deterministic, grounded structurer — not a VLM and not an on-device LLM.** Apple Vision on iOS, ML Kit (unbundled) on Android, via a local Expo module emitting DocDOM; `@snap/docai-preview` points at spans. The device reading is stored as a `document_layouts` row (`shadow = true`, no `extraction_run_id`), never as an `extraction_runs` row — revising `docs/OCR.md` §4.9's storage sentence while keeping D32's intent | No licence-clean VLM fits a 4 GB phone with a published number; a VLM emits values without spans (D16); platform OCR adds zero weights, runs on an iPhone 11 and a Galaxy A16, and its output is the contract we already have. Keeping the device out of `extraction_runs` makes "never the record" structural |
| **D39** | **Zero model weights ship in the app until a measured gap says otherwise.** `weightsLicence: 'none'` for both device engines; the bundled ML Kit artefact is `'proprietary'` and fails CI; PP-OCR (Apache-2.0) is the only weight permitted to enter the APK later | D23 applied to the APK, which is a redistributable image; keeps the licence floor a control |
| **D40** | **The read-only preview depends on the gold set (B1), not on calibration (B3); the live quality gate keeps D37's dependency.** The show/hide threshold is chosen per field from the measured coverage–risk curve so wrong-when-shown stays under §6.3's ceilings | D37's failure modes are a nag that is too eager or too shy; a blank field nags nobody. Measuring before shipping is what D37 actually requires, and §6 does that |
| **D41** | **Nothing a person has read changes silently.** Server values replace preview values with a visible chip; a human edit is a correction that locks the field via the existing `locked_fields` mechanism; confirm-and-post does not exist until the server's document does | The product's pitch is that the numbers are right; a number that changes under someone's eyes says the opposite. `locked_fields` already encodes human-over-machine; the preview only moves the human's edit earlier in time |
