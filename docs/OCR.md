# Document engine — architecture & delivery plan

**Status:** draft for review · **Date:** 2026-09-11 · **Supersedes:** the extraction
sections of `docs/AI.md` §2.1 and `docs/PLAN.md` §4 (see §12, *Decisions revised*)
**Revised 2026-09-12** by a five-reference competitive scan
(`docs/document-engine-competitive-review.pdf`): see §2 on PP-OCRv6 and the
licence floor, and D34–D37 in §11. **To build against this, use
`docs/GAPS.md`** — the ordered ticket queue with acceptance criteria.

What exists today reads Australian receipts. What is planned here reads
*documents* — receipts, invoices, statements, contracts, financial reports with
tables and charts, and filled-in forms — and does it in a way a regulated
enterprise can deploy, audit and defend.

This is not a rewrite. It is the pipeline the current one is already the first
slice of: the same principle (§1), the same validators, the same
review-and-correct flywheel, widened from one document class to a general
document object model with a real reading stage underneath it.

---

## 0. Scope, honestly stated

Four answers shaped this plan, and two of them pull against each other. Both
are recorded here rather than quietly reconciled.

1. **"A capability inside Snap Apps" and "must run air-gapped" are different
   products.** Nobody air-gaps a consumer tax app. Air-gap only means something
   if the engine can be deployed away from Snap Apps — which is the platform
   answer, not the capability answer.

   **Resolution:** air-gap capability is a *design constraint* in v1, not a
   shipped deliverable. Concretely: the engine is a package with no vendor
   assumptions, the default reading path uses open weights we can
   redistribute, and every engine declares its network and residency
   requirements so the router can be forbidden from calling out (D17, D23).
   That costs a few days now and is unbuyable later. The actual on-prem SKU —
   packaging, licensing, support, update channel — is Phase 5, and only if a
   customer pays for it.

2. **Four document classes at sellable accuracy is not one v1.** Receipts,
   business documents, charts and handwriting have nothing in common except
   the pipeline that carries them. Handwriting alone is where every
   open-source stack is weakest, and pretending otherwise is how a demo
   becomes a support queue.

   **Resolution:** one architecture handles all four from day one. The
   *accuracy commitment* is staged (§8), and every class routes to human
   review until it clears its gate. A class that has not cleared its gate is
   still useful — it is just honest about its confidence, which is the whole
   design.

3. **"Light enough for mobile" does not mean extraction on the phone.** D1 and
   D3 already settled this and nothing here reopens it: on-device extraction
   is unreplayable, and replayability is what makes "re-run history through a
   better model" a command instead of a migration. The phone does capture
   quality, page detection, dewarp preview and the offline queue — and may
   show a provisional local reading, clearly marked as provisional (D21).

---

## 1. The principle, restated for documents

> **A model reads. Deterministic code decides.** — `docs/AI.md` §1

That principle survives the widening, and one clause is added to it, because
it is what makes a general document engine trustworthy:

> **Nothing is asserted that cannot be pointed at.** Every value the engine
> emits carries the region of the page it was read from. A value with no
> region is not a value — it is a hallucination with good manners, and it is
> discarded before anything downstream sees it (D16).

This is the structural answer to the failure generative OCR introduced. The
open stacks moved from "misrecognition" to "hallucination" when they moved to
end-to-end VLMs, and the honest ones say so. A pipeline that requires
grounding cannot hallucinate a total, because a total with no bounding box is
rejected by the type, not by a reviewer's attention.

---

## 2. What we are competing with, and where it actually loses

The open field in 2026 is good and getting better fast. Any plan that pretends
otherwise is planning to lose. On the public benchmarks:

| Stack | Shape | Where it stands |
|---|---|---|
| **Chandra 2** (Datalab) | End-to-end VLM | ~85.8 on olmOCR-Bench — best single published number |
| **olmOCR 2** (Ai2) | End-to-end VLM | ~82.4 on olmOCR-Bench; fully open training recipe |
| **PaddleOCR-VL 1.6** | 0.9B VLM, Apache-2.0 | ~94.18 (third-party) / **96.3 claimed by its README** on OmniDocBench v1.6 |
| **MinerU 2.5** | Hybrid: pipeline + VLM backends | ~93.04 on OmniDocBench v1.6 |
| **Marker / Surya 2** | 650M VLM doing layout + OCR + equations | Best cost/accuracy of the small VLMs |
| **Docling** (IBM / Linux Foundation) | Pipeline, `granite-docling-258M` VLM path | Broadest input coverage, MIT, strong on pure CPU |

**Every number in that table is someone else's.** Some are third-party
leaderboard scores, some are vendor READMEs, and OmniDocBench and olmOCR-Bench
are different tasks on different corpora and are not comparable to each other —
still less to our eight-field docket harness (§8.1). **We have never scored any
of these against anything, on any input.** The table is a map of the field, not
a measurement, and §8 exists to replace it with one.

**Two of the systems named above cannot be shipped to a customer, and they are
the two this table praises most.** A scan of the Hugging Face model index on
12 September 2026 (`docs/document-engine-competitive-review.html`):

| Model | Licence | Redistributable under D23 |
|---|---|---|
| `datalab-to/chandra-ocr-2` | OpenRAIL | **No** |
| `datalab-to/surya-ocr-2` | OpenRAIL | **No** |
| `PaddlePaddle/PP-OCRv5` | Apache-2.0 | **Yes — and it is what we run** |
| `nanonets/Nanonets-OCR-s` | none stated | **No.** An unstated licence is an unusable one |

OpenRAIL carries use restrictions and is not an OSI-approved licence, so it
fails the Apache-2.0/MIT floor D23 sets for anything entering a redistributable
image. This is D23 doing precisely what it was written for — *"discovering that
during a customer's procurement review is a bad day that CI can have instead"* —
and it means the two systems with the best published numbers are reference
points we can measure against and never ship.

It also means the Phase 1 choice of PP-OCRv5 was the only one of the four that
was ever available to us. That was reasoned from the licence floor rather than
from the leaderboard, and the scan confirms the reasoning rather than the luck.

PaddleOCR is worth singling out, because it is the strongest candidate for the
tiers that have to run where we cannot call an API: Apache-2.0, self-hostable,
0.9B for the VL model with 1.5M/7.7M/34.5M tiers beneath it, ONNX and OpenVINO
backends, and a browser build. That is the shape T1 needs (§4.4) and it clears
the licence floor (D23) — which makes verifying its claims Phase 0 work rather
than a curiosity.

#### And we are a generation behind inside a library we already pin

`services/docai-engine/requirements.txt` pins `paddleocr==3.7.0`. That **is**
the current release (11 June 2026) — we are not behind on the library. But
the headline feature of 3.7.0 is **PP-OCRv6**, and `ocr_engine.py` names
`PP-OCRv5_server_det` / `PP-OCRv5_mobile_det` explicitly, with
`ENGINE_ID = "ppocr-v5"`. The newer weights are already downloadable from the
version we installed; the code asks for the older ones by name because it was
written before they existed.

| Tier | Params | PaddleOCR's own claim (not measured by us) |
|---|---|---|
| tiny | 1.5M | 6.1× speedup on Apple M4 |
| small | 7.7M | — |
| medium | 34.5M | **+4.6% detection, +5.1% recognition over `PP-OCRv5_server`**; 5.2× CPU via OpenVINO; 0.13s/page on A100 |

Three consequences, all of which land on something this document already
cares about:

1. **Detection is our weakest measured number and the exact thing the upgrade
   targets.** §8.1's OCR run scored recall 0.875 — seven of eight regions. A
   claimed +4.6% detection is directly aimed at that gap, and the harness to
   check it already exists.
2. **The 5.2× CPU figure is quoted for OpenVINO, not oneDNN.** Our sidecar
   runs with `enable_mkldnn=False` because PaddlePaddle 3.3.1's oneDNN
   executor throws on both detection models — a documented, verified
   workaround that leaves us with *no* CPU accelerator at all. OpenVINO is a
   different backend we have never tried. The workaround may have an
   alternative rather than being the floor.
3. **Phase 1b names no model, and tiny/small/medium is exactly its shape.**
   §4.9's three-tier device plan was written against PaddleOCR's tier
   structure; PP-OCRv6 is that structure, one generation newer, with a
   published Apple-silicon number.

Licence and cost do not change: still Apache-2.0, still self-hosted, still
near-zero per page. See D34.

**The uncomfortable half.** The same project ships **PaddleOCR-VL 1.6**, which
claims 96.3% on OmniDocBench v1.6 and is also Apache-2.0 — so unlike Chandra
and Surya we *could* ship it. That model competes with this entire reading
stage, not a part of it. That is not a threat provided we stay honest about
where we differ, which is the next three paragraphs.

Three things follow, and they set the whole strategy.

**First: do not compete on page-to-markdown.** That race is crowded, well
funded and measured to two decimal places. We would be a year behind on the
day we started, and the prize is a number on a leaderboard.

**Second: their target is not our target.** Every one of those stacks
optimises *document → markdown for RAG*. For that purpose an
approximately-right total is fine, because a retrieval system shows a human
the passage anyway. Our output posts to a double-entry ledger and files a BAS.
Approximately-right is the failure mode, not the acceptable case.

**Third: what they do not give you is exactly what an enterprise buys.**

| Requirement | Docling / MinerU / Marker / olmOCR | Ours |
|---|---|---|
| Per-value provenance (bbox, engine, confidence) | Block-level at best; usually none | **Mandatory on every value** (D16) |
| Calibrated confidence | Not reported | **Calibrated and measured** (D20) |
| Abstention — saying "I could not read it" | Effectively absent; VLMs fill the gap | **First-class; the prompt and the type both demand it** |
| Hallucination detection | None | **Independent-engine disagreement** (§4.5) |
| Domain validation of the reading | Out of scope | **Arithmetic, checksum, date, ATO rules** (existing `validators.ts`) |
| Deterministic replay of a past run | No | **Versioned run; same bytes ⇒ same document** |
| Audit trail and human-correction lineage | No | **Already in the schema** (0003, 0004, 0009) |
| Residency enforcement | No concept | **Engine registry + deployment profile** (D17) |
| Preserves the document's own layout | Transcribed into *their* shape | **Editable digital twin, laid out as itself** (§5) |
| Edit the result, keep the original | No concept | **Append-only edits over an immutable original** (D24, D25) |

**So the claim "better than what's on GitHub" is made precise, and it is not a
claim about character error rate.** It is: *at comparable reading accuracy, we
know when we are wrong, we can prove where every number came from, and we can
be deployed somewhere that forbids the internet — and what comes back is
still the user's document, editable, not our form.* That is measurable (§8),
and it is worth more to a finance team than two points of CER.

Where we do need to match them — raw reading accuracy on ordinary pages — we
**use them**. Most are permissively licensed and several are excellent. The
pipeline is ours; the engines are pluggable and partly borrowed (D14).
Building our own line-recognition model to be 1% better than Surya would be
vanity.

### 2.1 The nearest prior art is ours, and it is instructive

`gaiadabali/ai-parsing`, live at `aiparsing.gaiada.online`, already does
document extraction in production: **LlamaParse** (agentic tier) for OCR and
layout, then **deepseek-chat** for four of its five LangGraph nodes. It is the
closest thing to a control group this plan has, and it was read at source
rather than benchmarked — nothing below is a score we ran.

| Scenario (n=5 fixtures, 34 runs) | Self-reported confidence | Outcome |
|---|---|---|
| `clean_typed_invoice` | 95–97 | auto-approved, 8/8 |
| `scanned_crumpled_receipt` | 62–68 | flagged, 8/8 |
| `multipage_buried_table` | 95 | flagged, 6/6 |
| `unrecognized_vendor` | 95 | escalated, 6/6 |
| `handwritten_correction` | 40–45 | escalated, 6/6 |

Read that column carefully: **it is the model scoring its own homework**, not
measured accuracy, on five hand-built fixtures the prompts were written
against. Consistency across repeats is real, but it is the consistency of a
demo, not evidence of accuracy.

Four observations, each of which is an argument this document has already made
— now with a deployed instance behind it rather than a principle:

1. **Its decision thresholds are prose.** `CONFIDENCE_FLAG=75` and
   `ESCALATE=50` are real constants in `config.py` — and they are f-string
   interpolated *into the DeepSeek system prompt*. No `if` statement compares
   anything. The routing decision that determines whether a human sees the
   document is made by a language model reading two numbers in its own
   instructions. This is the exact failure mode "a model reads, deterministic
   code decides" exists to prevent, and it is running in production today.
2. **The only genuinely measured quantity in that system is the deterministic
   one.** Its `totals_crosscheck` caught a line sum of 518.00 against a stated
   512.00 on the crumpled receipt, and 760.00 typed against 700.00
   struck-through on the handwritten one. Cheap arithmetic found what a 95%
   self-reported confidence did not. That is `validators.ts` §4.8 in
   miniature, and it is the part worth keeping.
3. **It is built on the one model our own bench excluded.** `docs/AI.md` §2.3
   measured deepseek-v4-flash calling the right tool 4/4 and then failing to
   report what the tool returned — "a model that ignores the authoritative
   answer it just requested is worse than one with no tools". Choosing an
   extraction model without a harness is how that happens.
4. **Its Payload access control is `read/create/update/delete: () => true`.**
   All 40 invoice records, with full transcripts, are readable
   unauthenticated. Not an OCR lesson — a reminder of why capture, extraction
   and documents in this system sit behind RLS that the worker itself goes
   through (`worker.ts`), rather than behind application discipline.

**No comparison between ai-parsing, PaddleOCR and this pipeline has ever been
run.** Three architectures have been read; none has been scored against
another on the same input. That run is Phase 0 work (§9).

---

## 3. Architecture

```
                      ┌──────────── device ────────────┐
                      │ page detect · dewarp preview   │
                      │ quality gate · multi-page tray │   provisional read only
                      │ offline outbox                 │   (never the record, D21)
                      └───────────────┬────────────────┘
                                      │ original bytes, unmodified
┌─────────────────────────────────────▼──────────────────────────────────────┐
│  @snap/docai — the document engine (pure; no DB, no network of its own)    │
│                                                                            │
│  1 INTAKE      demux · PDF text layer + glyph boxes · rasterise · office    │
│  2 RESTORE     orientation · boundary · dewarp · deskew · glare · scale     │
│  3 LAYOUT      regions (text/table/figure/form/sig/stamp/hand) · order      │
│  4 ROUTE       per-region engine choice, cheapest-capable first             │
│       ├─ text ──────► T0 text layer │ T1 OUR det+rec │ T2 VLM │ T3 frontier │
│       ├─ table ─────► structure model → cells with row/col spans            │
│       ├─ figure ────► chart classify → series recovery → data table         │
│       ├─ form ──────► field/label pairing · checkbox state · signature      │
│       └─ hand ──────► HTR, low-confidence by default                        │
│  5 FUSE        reconcile engines · calibrate · flag disagreement            │
│  6 DocDOM      pages▸blocks▸lines▸spans · tables · figures · fields         │
│                every node: bbox + confidence + engine + page                │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │  DocDOM (the contract, D15)
┌─────────────────────────────────────▼──────────────────────────────────────┐
│  Semantic layer                                                            │
│  7 CLASSIFY    document class ⇒ which schema applies                        │
│  8 EXTRACT     schema-driven, GROUNDED: every field cites DocDOM spans       │
│  9 VALIDATE    arithmetic · checksums · dates · ATO elements · schema rules  │
│ 10 ROUTE       auto_accepted │ needs_review, with the failed check attached  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼──────────────────────────────────────┐
│  Twin layer (§5)                                                           │
│ 11 STYLE       fonts · rules · fills · object patches (logo/stamp/sig)     │
│ 12 EDIT        append-only patches against node ids · bound to fields      │
│ 13 RENDER      original │ annotated edit │ twin │ diff · certified export  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
  captures (L0) · layouts (L2) · edits (L3) · documents · corrections · ledger
```

### 3.1 Package layout

```
packages/
  docai/            Pipeline + DocDOM + grounding. Pure TS. No DB, no cloud SDK.
  docai-engines/    Engine adapters behind one interface. Declares residency.
  docai-eval/       Gold sets, scorers, benchmark runners, CI gates.
  docai-render/     DocDOM → scene graph. Shared by device, web and export.
  docai-mobile/     Native module: ONNX/TFLite runtime + the device tier (§4.9).
  api-contract/     DocDOM wire types added here (mobile renders overlays).
```

`packages/db` and `packages/tax-engine` stay server-only, and
`test/boundaries.test.ts` is extended: **`@snap/docai` must not reach
`@snap/db`**. The engine is a function from bytes to a document, and a
function that can read the database is not a function — it is a subsystem
nobody can test or replay.

---

## 4. The stages, and why each one earns its place

### 4.1 Intake — the free accuracy is in the PDF

The largest accuracy win available is not a model. **A digital-native PDF
already contains its text, with exact glyph positions.** Running OCR over it is
strictly worse than reading it: slower, costlier, and capable of errors the
embedded layer cannot make.

So intake demuxes by what the file actually is, not what it is called:

| Input | Path |
|---|---|
| Digital-native PDF | Extract text + glyph boxes (pdfium/MuPDF). **Tier 0: exact, free, deterministic.** Rasterise only for figures and tables. |
| Scanned PDF | Rasterise per page at a DPI chosen from the page, then the full pipeline. |
| Mixed PDF | Per page, per region. Common in practice: a generated invoice with a scanned signature page. |
| Photograph | The full pipeline, restoration first. |
| Office / HTML / email | Parse natively to DocDOM. Phase 2. |

This also closes a gap in the current build: `/^image\//` at
[`captures.controller.ts:135`](../apps/server/src/captures/captures.controller.ts#L135)
rejects PDFs outright, which blocks the most common way a supplier invoice
actually arrives.

### 4.2 Restoration — where phone photos are won or lost

The benchmark that matters here is not a flat scan. It is a creased thermal
docket photographed at 2am in a truck stop, which is exactly what
`bench/compare.py` already scores against. Restoration is cheap, deterministic
CPU work and it lifts every downstream engine at once:

- Orientation and rotation from EXIF plus content (a 90° error costs everything)
- Document boundary detection and perspective rectification
- **Dewarp** — a curled receipt is the characteristic Australian failure case;
  line recognition falls apart on a curved baseline long before it does on a
  faded one
- Shadow and glare normalisation, illumination flattening
- Deskew, denoise, and a resolution policy (upscale small text, cap the rest)

libvips (already present via `sharp`) plus OpenCV, with a small learned dewarp
model. This stage runs identically on the phone for the *preview* and on the
server for the *record* — same code, different trigger.

### 4.3 Layout and reading order

Region detection over the page: text block, heading, list, table,
figure/chart, caption, form field, checkbox, signature, stamp, handwriting,
barcode/QR. Then reading order — which is not raster order, and gets
multi-column statements and two-up invoices wrong when treated as such.

This is the one place a small VLM (Surya-class, ~650M) is simply the right
tool, runs acceptably on CPU, and is permissively licensed. We adapt; we do not
reinvent.

### 4.4 The OCR stage we own, and how regions are routed

Today there is no OCR stage at all. A vision-language model is handed the
whole page and asked for JSON — the architecture the literature calls
**OCR-free**. It is a legitimate design, and it is the wrong one here for a
reason that has nothing to do with accuracy: **it never locates anything.** A
model that goes from pixels straight to meaning cannot say *where* on the page
a total was printed, which is why `docs/extraction-schema.json` has always
promised a `bbox` that `types.ts` cannot deliver.

Three things in this document depend on that coordinate and are impossible
without an OCR stage:

- **D16, grounding.** You cannot point at what you never found.
- **§5, the editable twin.** An aligned text layer, tap-to-edit at the right
  position, edits bound to page coordinates — all of it is localisation.
- **D20, calibrated abstention.** A recogniser reports per-character
  confidence out of its own logits. A generative model reports a fluent guess.

So we build the stage we currently skip: **detection and recognition that we
own** (D29), emitting text with coordinates, and the VLM is demoted from *the
reader* to *the escalation path for regions the recogniser flags*.

**What "ours" means, precisely.** We are not training weights yet (D30). The
stage is ours; the weights inside it are borrowed, open and swappable:

| Part | Now | Later |
|---|---|---|
| Detection + recognition **weights** | PP-OCRv5 — Apache-2.0, downloaded, self-hosted | Fine-tuned on our own AU docket corpus |
| The **stage**: preprocessing, tiling, batching, box merging, line assembly, script routing, confidence extraction and **calibration**, DocDOM emission, disagreement checks, escalation policy | **Ours from day one** | Unchanged — that is the point |

This is what turns the corpus into a moat rather than a hope. The review
screen has been collecting `(image, machine reading, human correction)`
triples since migration 0004, and fine-tuning a small recogniser on Australian
thermal dockets is a far cheaper first "our own weights" milestone than
training a VLM. The interface it plugs into exists on day one.

**It also fixes what neither §2 nor the cost model could.** A recogniser runs
on CPU in milliseconds per line, costs nothing per page, has no rate limit,
works offline and on a phone — and being discriminative rather than
generative, **cannot invent a line item that was never printed.**

Routing is then the rule already in
[`router.ts`](../apps/server/src/ai/router.ts), generalised from documents to
regions: **each region goes to the engine best for it, cheapest-capable
first, escalating on failure.**

| Tier | Engine class | Runs where | Cost |
|---|---|---|---|
| **T0** | Embedded PDF text | Anywhere | Free, exact |
| **T1** | **Our OCR stage** — PP-OCRv5 detection + recognition, self-hosted | CPU, air-gapped, mobile | Near-free |
| **T2** | Open-weight document VLM, self-hosted GPU | Our cloud, customer VPC, air-gapped | GPU-seconds |
| **T3** | Frontier VLM (Claude on Bedrock `ap-southeast-2`) | Cloud profiles only | ~$6–11/1k pages |

Most of a page is T0 or T1 — and T1 needs no GPU, which removes the largest
operational cost in §7. T3 sees the 5–15% of regions that are genuinely
hard — the glare-covered total, the handwritten annotation. That is what makes
the blended cost defensible at enterprise volume instead of the flat
frontier-per-page cost the current design implies.

### 4.5 Fusion, calibration and disagreement

Where two independent engines read the same region, agreement is evidence and
**disagreement is the most reliable hallucination detector available** — far
better than asking a model how sure it is. A frontier VLM's self-reported
confidence is a fluent guess; two architecturally different readers producing
different digits is a fact.

Confidence is then **calibrated**, not taken raw: temperature scaling against
the gold sets, so a field marked 0.95 is right about 95% of the time. Today's
confidences are the model's own opinion and are treated as advisory in
`validators.ts` — correctly, because they are uncalibrated. After this they
mean something, and the `auto_accepted` threshold becomes a risk decision
instead of a guess.

### 4.6 DocDOM — the contract (D15)

One versioned structure, emitted by reading and consumed by everything else:

```
Document
  pages[]      : size, dpi, rotation, source (scan|native|photo)
  blocks[]     : type, bbox, page, reading_order, confidence, engine
    lines[] → spans[] : text, bbox, per-char confidence
  tables[]     : cells[{row, col, row_span, col_span, bbox, content_ref}]
  figures[]    : kind (chart|photo|diagram|logo), chart{type, series[], axes}
  fields[]     : key_span, value_span, control (text|checkbox|signature)
  provenance   : engine per node, run id, restoration ops applied
```

Why a DOM and not markdown: markdown cannot carry a bounding box, a
confidence, or which engine produced a cell — so a markdown-shaped pipeline
cannot be audited, and an unauditable pipeline cannot be sold into finance.
Markdown is one *rendering* of DocDOM, and we will emit it, for RAG consumers
who want it.

### 4.7 Grounded semantic extraction

Only here does anything become a *field*. The document is classified, the
classification selects a schema (`docs/extraction-schema.json` is the AU tax
one; others join it), and the extractor's job is reduced from *reading* to
*pointing*: for each schema field, identify the DocDOM spans that carry it.

Three consequences, all good:

- **A field with no span is null.** Not low-confidence — null (D16).
- The extractor can be a much smaller model, because reading is already done.
- The review UI can highlight the exact pixels behind every number — the most
  requested feature in every document product ever shipped, falling out of the
  architecture instead of being retrofitted.

### 4.8 Validation, unchanged in spirit

[`validators.ts`](../apps/server/src/extraction/validators.ts) is the most
valuable code in the pipeline and it does not change — it generalises. Per
schema, a rule set; per rule, a source; per failure, an escalation or a review
task. The new classes bring new deterministic checks, which is the part
competitors structurally cannot copy without owning a domain:

- **Tables:** row and column totals must reconcile; a sub-total that does not
  add up is a structure error, not a value the user should see
- **Charts:** a pie must sum to 100%, a stacked bar's segments must sum to its
  labelled total, an axis must be monotonic. A series that violates its own
  geometry was misread
- **Forms:** mutually exclusive checkboxes, required-field completeness
- **Handwriting:** never auto-accepted above a configurable money threshold,
  regardless of confidence

### 4.9 The same stage, on the phone

Owning the OCR stage (§4.4) changes what the device can do. A vision-language
model cannot run on a phone; **a 1.5M-parameter detector and a quantised
recogniser can**, and they are the same stage the server runs, one tier
smaller. That makes the phone a legitimate engine in the registry rather than
a camera with a preview.

**What it is for — and what it is emphatically not.** D1 and D3 stand: the
device reading is **advisory, never the record** (D21). It is stored as an
extraction run with `engine = 'device'`, and the server's run remains
authoritative, because replayability is what makes "re-run history through a
better model" possible and an on-device result cannot be replayed. Within that
boundary it earns four things worth real engineering:

1. **A quality gate that fires while the receipt is still in your hand.** Not
   "is this blurry" but "I cannot read the total" — the only feedback that
   actually prevents a re-shoot two days later.
2. **Instant provisional reading.** The user sees the total the moment the
   shutter fires, clearly marked provisional, instead of waiting on a queue.
3. **Offline capture that is still useful.** Read, categorise and queue with
   no signal; the server confirms later.
4. **A free disagreement signal.** Device and server run the *same* stage, so
   their outputs are directly comparable. Agreement raises confidence;
   divergence flags the region — the §4.5 mechanism, at no extra cost.

#### Making it run on any phone

"Any phone" means a low-end Android with 2–3 GB of RAM, no NPU and a cold
thermal budget — not a recent iPhone. The design targets that device and
treats everything better as headroom.

| Lever | Approach |
|---|---|
| **Model tier** | Three sizes (≈1.5M / 7.7M / 34.5M), chosen at runtime from a device-capability probe. The weakest phone gets detection only; the strongest gets detection plus the largest recogniser. |
| **Quantisation** | INT8 dynamic for CPU, FP16 where a delegate benefits. Weights land in single-digit megabytes. |
| **Runtime** | ONNX Runtime Mobile or TFLite behind one native module. A React Native bridge is unavoidable: this is native code, not JS. |
| **Delegates** | NNAPI / Core ML → GPU → XNNPACK multi-thread CPU → **server-only**, in that order. The last rung is a real outcome, not a failure. |
| **Resolution policy** | Detection on a downscaled frame; recognition on crops normalised to a fixed height (~32–48 px). Recognition cost scales with *text*, not with megapixels. |
| **Frame budget** | Detection only on preview frames at 2–5 fps for the quality gate; recognition runs once, on shutter. |
| **Thermal and battery** | A sustained-inference cap with back-off. A capture app that heats the phone gets deleted. |
| **Memory** | One session, loaded on camera open and reused; no per-frame allocation. |
| **Delivery** | Weights downloaded on first run and cached, so the binary stays small — with a bundled-weights build for offline-first and air-gapped deployments. |

**Targets on a mid-range device**, to be verified rather than assumed:
detection under ~150 ms, recognition under ~10 ms per line, a whole receipt
under ~1 s, and a cold start under ~500 ms.

**One consequence worth stating before it bites.** Native code cannot ship
over the air, and D10 chose Expo partly *for* OTA updates. Model weights can
be updated OTA because they are data; the runtime and the native module cannot
— they need a store release. So the device tier's release cadence is slower
than everything else in this document, and the seam has to be designed for a
phone running last quarter's runtime against this quarter's weights.

Rendering what is read is a separate problem, solved by the same scene graph
the server uses — see §5.8.

---

## 5. The document stays itself

Every stack in §2 — and every commercial document API — does the same thing
with a page: it reads values out and throws the page away. What comes back is
*their* shape. A JSON form. A markdown transcription that has lost the columns,
the rules, the logo, the stamp and the handwritten note in the margin. The
document becomes a record *about* a document.

That is the wrong artifact here, for three independent reasons:

1. **People recognise their own receipt, not our form.** A user checking
   whether the total is right does it by looking at the total *where it was*,
   in the layout they remember. A field list forces them to re-read a document
   they have already read, in an order it was never written in.
2. **The original is the legal record and must stay unaltered** — but a record
   you can only *look* at is not a working document. Both have to be true at
   once: untouched, and editable.
3. **An edit is evidence.** When someone corrects a misread ABN, the valuable
   artifact is not the corrected value alone; it is the pairing of *what was
   printed*, *what the machine read*, and *what the human said it was*, at a
   known position on a known page.

So the engine's output is not an extraction. It is a **digital twin**: the
document, as data, laid out as itself, editable, with the original beneath it
and every change recorded against a coordinate.

**The template is the document.** That single sentence is the difference
between this and everything in §2.

### 5.1 Five layers

| Layer | What it is | Mutability |
|---|---|---|
| **L0 — Original** | The bytes as uploaded. The ATO's "true and clear reproduction". | **Never written twice.** Not re-encoded, not rotated, not cropped. |
| **L1 — Canvas** | Per page: the restored raster (dewarped, deskewed, delit) *and the transform back to L0 coordinates*. | Derived; regenerable from L0. |
| **L2 — Content** | DocDOM (§4.6) plus presentation: glyph boxes, baselines, font class/size/weight/colour, rules, fills, borders, z-order, and extracted object patches (logo, stamp, signature, photo). | Written once per extraction run. |
| **L3 — Edits** | An append-only list of patches against L2 node ids: who, when, old, new. | The only layer a human writes. |
| **L4 — Bindings** | Schema fields (`supplier_abn`, `payable_amount`, a table cell, a chart series) pointing at L2/L3 nodes. | Derived from L2+L3. |

What the user sees is `L1 + L2 + L3`. What the auditor is shown is `L0`, plus
the diff. What the ledger consumes is `L4`. Nothing is duplicated between
them — they are projections of one object, which is the only way they cannot
drift.

**L1 carries the transform, and that is not a detail.** Every bbox must be
expressible in *original* coordinates. Otherwise a highlight lands correctly on
the dewarped copy and wrongly on the document the ATO would actually be shown.

### 5.2 The rule that makes fidelity cheap

Re-rendering a scanned document faithfully is genuinely hard: fonts are
unknown, backgrounds are textured, thermal print is grey-on-grey. Most attempts
fail because they try to redraw the whole page.

**We never redraw what nobody changed (D26).** Unedited text stays as the
original pixels; only an edited run is synthesised, composited into the space
its predecessor occupied.

The consequences are worth being explicit about, because this one decision
removes most of the risk in this section:

- Fidelity on untouched content is not *high*, it is **exact** — it is the
  photograph.
- The rendering cost is proportional to what was edited, not to page count.
- A visual diff between twin and original shows precisely the edits and nothing
  else, so "what changed" needs no separate tracking mechanism.
- Font matching stops being a correctness problem and becomes a cosmetic one
  affecting only edited runs.

### 5.3 Four views, in the order they should be built

| View | What it shows | Fidelity risk | Phase |
|---|---|---|---|
| **Original** | L0 pixels, with tap-to-inspect overlays: confidence, engine, which field this is | None | 1 |
| **Annotated edit** | L0 pixels underneath, an aligned transparent text layer on top; edits drawn as tracked changes over the original | Near zero | 1 |
| **Twin** | Full re-render from L2+L3, original pixels reused per §5.2; reflows, prints, exports, reads aloud | Real, measured (§8) | 2 |
| **Diff** | Twin against original, pixel and value | — | 2 |

**Annotated edit is the default, and it is most of the value.** It needs only
bounding boxes and text — which Phase 1 produces anyway — and it already
delivers "see the scan, edit the scan, keep the original". The full twin is
required for export, reflow, accessibility and search, and it is where the
hard problems live, so it follows rather than leads.

### 5.4 Editing: what happens when the new text is longer

A raster document has no reflow. Replacing `$266.91` with `$286.91` is easy;
replacing a supplier name with one twice as long is a layout question, and
pretending otherwise produces overlapping text.

Each block therefore carries a **fit policy**, defaulted by block type and
overridable per block:

| Policy | Behaviour | Default for |
|---|---|---|
| `fixed` | Shrink-to-fit within the box, down to a floor, then clip and warn | Totals, amounts, dates, table cells |
| `grow-down` | The box grows; following blocks in the column shift down | Addresses, descriptions, notes |
| `reflow` | Full paragraph reflow within the column | Body text in contracts and letters |
| `anchored` | Never moves; overflow is an error the user must resolve | Stamps, signatures, form fields |

Two supporting mechanics:

- **The clean plate.** To replace text in place the twin needs the background
  *without* that text. Text regions are inpainted once per page and cached as a
  derived asset — median/diffusion fill for flat stock, a learned inpaint for
  textured or watermarked paper. Computed lazily, only for pages that get
  edited.
- **Fonts by metrics, not by name.** We do not try to identify the typeface.
  We classify it (serif/sans/mono/condensed, weight, slant), pick a
  metric-compatible embeddable face, and kern the synthesised run so it lands
  on the same baseline and advance as the glyphs it replaced. Only edited runs
  are affected (§5.2), so the bar is "does not look wrong next to its
  neighbours", not "is indistinguishable".

### 5.5 Data and document are one object

The failure mode of every "scan then edit" product is two copies: a form the
user edits and a document they look at, drifting apart the moment either is
touched. L4 bindings prevent it structurally — **a field *is* a pointer to a
node** (D27). Correcting the total in the form and correcting it on the page
are the same write, because there is only one place the value lives.

This also generalises the protection already in the schema. `documents.locked_fields`
and its trigger (migration 0009) stop a machine re-run overwriting a human
correction; with bindings, the lock is held on the **node id**, so a
re-extraction six months from now cannot quietly move a number a person put
there — on the page or in the form. A better model that disagrees raises a
review task, exactly as it does today.

### 5.6 Export, and the line that must not be crossed

Two export flavours, and they are never the same file (D28):

| Flavour | Contents | Use |
|---|---|---|
| **Certified copy** | L0 unaltered, plus an invisible searchable text layer and the DocDOM as attached metadata | The ATO, the auditor, the accountant. Byte-identical original inside; hash provable against `captures.original_sha256`. |
| **Working copy** | The twin: edits applied, reflowed, as PDF/DOCX/HTML/CSV/JSON | Sending, re-issuing, analysing, importing |

**A working copy must never be able to present itself as the original.** It
carries a visible provenance footer, embedded metadata naming the source
capture hash and the edit count, and it is stored as a *rendition*, never over
the top of L0. This is the same reasoning as D17: a document that can
impersonate a tax record is a forgery surface, and the cheapest time to make
that impossible is before the first one is exported.

### 5.7 Storage

| Thing | Where | Why |
|---|---|---|
| L0 original | S3 `ap-southeast-2`, SSE-KMS, write-once | Unchanged (D12) |
| L1 canvas, clean plates, object patches | S3, derived, regenerable | Big, binary, cacheable |
| L2 DocDOM | S3 as versioned JSON, **pointer + small index in Postgres** | A 50-page report's DocDOM is megabytes; it does not belong in a row that gets selected by a list screen |
| L3 edits | Postgres, append-only, RLS-scoped | Small, transactional, audited, queryable |
| L4 bindings | Postgres, alongside `documents` | The ledger joins against these |

New tables, following the existing conventions: `document_layouts` (one per
extraction run, pointer + index), `document_assets` (clean plates, patches,
renditions), `document_edits` (append-only patches). `document_field_corrections`
(0004) stays and becomes a *view* over the field-shaped subset of
`document_edits` — the training flywheel in `docs/AI.md` §3 keeps working
unchanged, and now collects layout corrections too.

### 5.8 Rendering it on a phone

One renderer, two hosts: DocDOM → a scene graph drawn on a canvas
(react-native-skia on device, the same scene graph to `<canvas>` on web).
Tiles and virtualised pages, because a 40-page statement cannot be a thousand
absolutely-positioned views. Tap a value → inline edit at the position it
occupies. Pinch-zoom is the primary navigation, since the thing being read is a
page, not a list.

---

## 6. Deployment profiles (D17)

Every engine in the registry declares what it needs:

```ts
type EngineSpec = {
  id: string;
  capabilities: RegionKind[];
  residency: 'in-process' | 'self-hosted' | 'vpc-endpoint' | 'external-api';
  requiresNetwork: boolean;
  weightsLicence: 'apache-2.0' | 'mit' | 'other' | 'proprietary';
  redistributable: boolean;
};
```

and the deployment profile decides which are eligible **before** a request is
routed:

| Profile | Eligible tiers | Guarantee |
|---|---|---|
| `cloud-au` | T0–T3 | Inference stays in `ap-southeast-2`; no APP 8 disclosure |
| `customer-vpc` | T0–T2; T3 only with the customer's own key | Nothing leaves their account |
| `air-gapped` | T0–T2, `requiresNetwork: false` only | No egress is *possible* |

This is the same shape as `BedrockClaudeProvider` throwing instead of falling
back to the development provider, and for the same reason: a pipeline that
quietly ships Australian tax records offshore because a config flag was wrong
is precisely the failure APP 8 exists to prevent. The profile makes it
unrepresentable rather than merely prohibited.

**Licence floor (D23):** only Apache-2.0 or MIT weights may enter a
redistributable image. Several of the strongest open OCR models are *not*
redistributable, and discovering that during a customer's procurement review
is a bad day. The registry records the licence; CI fails a portable build that
includes a non-redistributable engine.

---

## 7. Scale and cost

The existing `FOR UPDATE SKIP LOCKED` queue (D9) stays; it is the right answer
and costs nothing to operate. What is added:

- **A separate GPU worker pool** for T2, autoscaled on queue depth, with the
  CPU pool (intake, restoration, T0/T1, validation) scaling independently —
  they have completely different cost curves and must not share a deployment.
- **Per-tenant fairness** in the claim query, so one 4,000-page backfill cannot
  starve every other workspace's live scans.
- **A cost budget per tenant per period**, enforced before T3 is called and
  recorded in `extraction_runs.cost_micros` (the column already exists).
- **A batch path for backfill** — half price, no latency requirement.
- **Page-level parallelism** within a document, joined at DocDOM assembly.

Blended economics, and the reason routing matters:

| Design | Per 1,000 pages |
|---|---|
| Frontier VLM on every page (today's design, D2) | ~$6–11 |
| Tiered routing: ~85% resolved at T0/T1, ~10% T2, ~5% T3 | **~$0.60–1.20** |

An order of magnitude — and the margin that makes enterprise volume viable.

**Both rows are modelled, not measured, and the second is the weaker of the
two.** The frontier row derives from published Bedrock pricing against a
measured token count (`docs/PLAN.md` §4). The tiered row rests on an assumed
tier mix that nothing has yet observed; the 85/10/5 split is a hypothesis, and
Phase 1's real distribution replaces it. **No $/page figure has been measured
on the development provider and none can be** — the shared Ollama Cloud
account is weekly-rate-limited rather than per-token billed, so a cost taken
from it would be invented. `extraction_runs.cost_micros` exists to make the
production number an observation rather than an estimate; until it has data,
treat this table as a design target.

---

## 8. Evaluation is a deliverable, not a phase

The repo already has the right instinct: committed benchmarks, scores in the
docs, *"a registry of untested models is a registry of guesses"*. That is
extended into the product.

### 8.1 What we already measured, and why it cannot grade this work

`bench/compare.py` scores one degraded fuel docket — dim, motion-blurred,
creased, glare across the total — against exactly known ground truth, on eight
checkable fields:

| Model | Score | Latency | Output tokens |
|---|---|---|---|
| minimax-m3 | **8/8** | 4.7s | 273 |
| gemma4:31b | **8/8** | 3.8s | 140 |
| kimi-k3 | **8/8** | 7.9s | 381 |
| mistral-large-3 | **8/8** | 5.6s | 151 |
| qwen3.5:397b | **8/8** | 21.7s | 871 |
| kimi-k2.6 | 7/8 | 31.2s | 952 |
| glm-5.x · deepseek-v4-* · gpt-oss:120b · nemotron-3-super | — | — | **no vision** |

Three readings of that table, and the third is the one that shapes §8.

**It already argues for D18.** `gemma4:31b` read a 2am truck-stop photograph
perfectly in 3.8 seconds and 140 output tokens. The premise of tiering —
that cheap models handle ordinary pages and frontier models are for the hard
remainder — is not a hope here; it is the measured result on the *hard* case.

**It already argues for capability routing.** Four of the ten models cannot
accept an image at all and return HTTP 400. GLM and DeepSeek are text-only on
this provider — worth knowing before anyone designs a reading path around
either, which is exactly why `router.ts` makes a task name a *capability*
rather than a model.

**And it is exhausted.** Five of six vision-capable models scored full marks.
A benchmark on which everything ties cannot rank anything, cannot detect a
regression, and cannot tell us whether the twin, the tables or the charts got
better. **The gold sets below are not an enhancement of the existing bench;
they are its replacement**, and building them is Phase 0 work precisely
because every gate after it is meaningless otherwise.

Four caveats travel with that table and must not be dropped when it is quoted:

- **n = 1.** One synthetic image, generated by `bench/hard.py` from
  `bench/receipt.html`, one run per model. It is a smoke test that earned more
  authority than its sample size supports, including in this document's own
  §2 reasoning.
- **Only the total is stored.** There is no per-field breakdown, so "8/8"
  cannot tell us *which* field a model would have failed on a harder page.

- **The latency column was a single run against a shared, rate-limited
  account** — order-of-magnitude, not a benchmark, and carried in `router.ts`
  as `medianSeconds` while not being medians. **Re-measured 2026-09-11**: 5
  repeats across the 4-document corpus, 80 calls, n=20 pooled per model
  (`bench/results/20260911T080356Z`), and `router.ts` now carries those:

  | Model | was (n=1) | now (n=20) |
  |---|---|---|
  | gemma4:31b | 3.8 | **2.82** |
  | minimax-m3 | 4.7 | **5.39** |
  | kimi-k3 | 7.9 | **7.28** |
  | qwen3.5:397b | 21.7 | **23.21** |

  The pooled figure deliberately includes the two-page invoice, which sends two
  images and runs 3–4× slower for every model: multi-page is a shipped
  capability, so the number the router sorts on should describe the requests it
  actually serves. The speed *ordering* held on every document, so nothing here
  re-tiers anything — it corrects the magnitudes, which is all a median was ever
  supposed to do.
- **The provider is borrowed, shared and weekly-rate-limited.** Fine for
  development; it must not become a production dependency, and these numbers
  are not a capacity plan.

**What has never been measured — stated plainly, because the rest of this
document is easy to read as though it had been:**

| Question | Status |
|---|---|
| Two hosted models scored per field on the same documents | **Measured** 2026-09-11, n=4 documents × 2 repeats |
| Anything at all on a multi-page PDF | **Measured** 2026-09-11 — first time, and the model did read page 2 |
| Whether the validators catch a real model error | **Measured** — mod-89 and the date window both fire |
| PaddleOCR, LlamaParse or Docling on our documents | **Never run.** Adapters exist and have never executed; §2 is still vendor and third-party claims |
| Cost per document, for any option | **No figure exists** (§7 is modelled, and the dev provider cannot produce one) |
| Per-model latency on a real corpus | **Measured** 2026-09-11, 5 repeats, n=20 per model |
| Anything on a *real* AU docket | **Never run.** All four corpus documents are synthetic; the §8.2 gold sets do not exist yet |
| Layout fidelity of a re-rendered twin | **Never run**; the metric does not exist yet (§8.3) |

A plan is allowed to rest on judgement. It is not allowed to imply the
judgement was a measurement.

#### First results from the rebuilt harness (2026-09-11)

`compare.py` has been rebuilt to the shape §8.3 asks for: a committed
`manifest.json` with per-field ground truth, per-field outcomes including
**abstention as a success**, medians over repeated runs, JSON and markdown
results under `bench/results/<timestamp>/`, and engine adapters that report
"not run" rather than guessing. Four synthetic documents, one of them a
two-page PDF whose grand total and GST appear **only on page 2**.

A small deliberate run — two models, four documents, two repeats each
(`results/20260911T055249Z/`):

| Finding | Detail |
|---|---|
| **The tie is broken** | `minimax-m3` clean on every field, both repeats. `gemma4:31b` wrong on two fields. The old harness scored both 8/8. |
| **The date error, reproduced on demand** | `gemma4:31b` read `06/09/26` as `2006-09-26`, both runs — the exact twenty-year failure `docs/AI.md` describes from an earlier session. No longer anecdote. |
| **A one-digit ABN misread** | Ground truth `85129887341`, model output `85129887841`, both runs. The most expensive failure this product has. |
| **Abstention works** | On the no-ABN receipt, `supplier_abn` and `gst_amount` came back null, both runs, and scored as successes. |
| **Multi-page, measured for the first time** | The page-2-only fields came back exact, so the model genuinely read page 2 rather than stopping at page 1. |

**And the deterministic layer catches both model errors.** Checked against the
real `validators.ts`, not a reimplementation:

```
abnIsValid('85129887341')  valid      ground truth
abnIsValid('85129887841')  INVALID    what the model read
dateProblem('2006-09-26')  date_implausible
```

So the misread ABN is rejected by mod-89 and the misread date by the
plausibility window. **This is the first measured evidence for the premise of
this whole document** — a cheap model reads, and code catches what it gets
wrong — rather than an argument that it ought to work.

One further result worth recording, because it is the harder case: the
*correct* reading `2026-09-06` triggers `ambiguousDateOrder`, which offers
`2026-06-09` as the alternative. `06/09/26` genuinely is ambiguous, and the
validator raises it for human confirmation instead of silently choosing — the
behaviour §4.8 describes, confirmed on a real reading.

**A defect found in the gold set itself, worth recording as a lesson.** The
first version of this corpus used a ground-truth ABN that fails mod-89. Two
consequences: the document could never be `auto_accepted`, and the ABN misread
became invisible to the very check designed to catch it, because the correct
and incorrect values failed identically. The corpus was regenerated with
derived check digits, and `compare.py` now **asserts every ground-truth ABN
passes the checksum before any engine runs**. A gold set whose ground truth is
never validated rots silently, and everything in §9 is gated on this corpus
being right.

### 8.2 Gold sets, committed and versioned

| Set | Contents | Purpose |
|---|---|---|
| `au-receipts` | 500+ photographed AU dockets: thermal, creased, glare, faded | The house benchmark; nobody else has this |
| `au-invoices` | 300 supplier invoices, digital + scanned, multi-page | The most valuable class commercially |
| `business-docs` | 200 statements, POs, remittances, contracts | Layout and reading order |
| `reports-charts` | 150 pages of tables and charts with known underlying data | Structure and series recovery |
| `forms-hand` | 150 filled forms, mixed hand and print | The hardest class, measured honestly |
| `adversarial` | Rotated, torn, occluded, duplicated, multi-doc-per-photo | Failure behaviour |
| `layout-fidelity` | 200 pages with known structure, re-rendered and compared | The twin looks like the document (§5) |
| `device-matrix` | The receipt sets replayed on real handsets, low-end Android to current iPhone | Latency, thermal, memory and accuracy-per-tier on the floor device (§4.9) |

### 8.3 The measurements

**Public benchmarks, run as-is.** OmniDocBench v1.6 and olmOCR-Bench, scored
against the same stacks in §2, so the comparison is external and re-runnable
rather than a claim on a slide.

**The metric that is ours.** Everyone reports accuracy. We report the
**coverage–risk curve**: at each auto-accept threshold, what fraction of
documents pass without a human, and what fraction of *those* carry a wrong
value that reached the ledger. The number that matters to a finance team is
silent-error rate at a given automation rate, and no open stack reports it,
because none of them can abstain.

**Fidelity, which is also ours.** A twin is scored against the page it came
from, not against a transcript:

| Metric | What it asks |
|---|---|
| **Visual delta** | Perceptual diff (SSIM + glyph-level IoU) between twin and original at matched DPI, on an *unedited* document. Target: indistinguishable, since §5.2 means nothing was redrawn. |
| **Edit locality** | After one edit, does the visual diff show *only* that edit? A layout that shifts elsewhere is a bug with a number attached. |
| **Round trip** | Export → re-ingest → same DocDOM. Catches silent loss in the export path. |
| **Anchor drift** | A bbox mapped through L1 back to L0 lands on the right pixels. A highlight that is right on the derivative and wrong on the original is worse than no highlight. |

**CI gates.** Every engine change runs the gold sets. A regression in
field-level F1 — or, more seriously, a rise in silent-error rate — fails the
build. Same discipline as the 217-test tax engine, applied to reading.

---

## 9. Phases, with gates

Durations assume one engineer on the engine with the existing infrastructure;
they scale roughly linearly to two, and not at all beyond three.

### Phase 0 — Stop lying to the user (1–2 weeks)

No new capability. The three things that are wrong today:

1. **Multi-page capture silently discards pages.**
   [`capture.tsx:128`](../apps/mobile/src/app/(tabs)/capture.tsx#L128) uploads
   only the last shot while sending `pageCount: n`, so the database records a
   page count for pages that were never stored. On a legal record that is the
   worst class of bug — it is wrong *and* it claims to be right.
2. **PDF intake is rejected** at the controller.
3. **`docs/extraction-schema.json` promises bounding boxes** that
   [`types.ts`](../apps/server/src/extraction/types.ts) does not implement. The
   two schemas have drifted; one of them has to become true.

Plus the eval harness and the first gold set, because everything after this is
measured against it — and the head-to-head that has never been run.
`compare.py` grows from one synthetic image to a real multi-document set with
per-field scoring, and gains three entries beside the hosted models:
**PaddleOCR PP-StructureV3**, **LlamaParse**, and **Docling**. Multi-page PDFs
go in the set from the start, since that is the gap this whole document
exists to close.

**Gate:** a multi-page PDF invoice survives capture → extraction → review with
every page accounted for; and §2's table has a column of our own numbers in
it, on our own documents, per field.

#### Gate result, 2026-09-11 — passed, and what it cost to pass

A two-page PDF with 40 line items went in over HTTP and came out as a
document: both pages stored as `pdf_native`, both per-page images served,
`payableAmount` $17,519.31 read from a total printed **only on page 2**, 40
lines, GST $1,592.66 — exactly one eleventh of the inclusive total.

Four defects were found by running it, none of which any lane's own tests
caught. That is the argument for an end-to-end gate in one paragraph:

| Found | Why it mattered |
|---|---|
| **Fastify rejected `application/pdf`** before any of our code ran | The controller was correct and unreachable. A 415 that looks like a client bug and is not one. |
| **The 2,000-token output cap truncated a 40-line invoice** | Worse than the truncation: a cut-off response is *unparseable*, so it arrived as a parse error and the router escalated through all four models, each stopping in the same place. Escalation cannot fix a limit that is ours. Cap raised, and `finish_reason: 'length'` is now its own failure that does not escalate. |
| **One unreadable object killed the whole worker** | `runOnce` recorded the failure and then rethrew, abandoning every other job already claimed in the batch — still locked, with nothing to complete them, which is precisely the hazard its own comment warned about. |
| **`page_count` and `original_sha256` went stale after demux** | The dedup hash covered one declared page when the document had N, so the same PDF uploaded twice would stop deduplicating while `captures_sha_unique` still claimed it could not. |

A fifth defect surfaced later the same day, at the far end of the pipeline:
**the tax pack exported page 1 only.** `assembleTaxPack` read
`captures.original_storage_key`, which holds the first page and nothing else,
so a two-page tax invoice left the building as one image while `index.csv`
claimed the document was complete — Phase 0's own bug, reappearing on the
record the ATO would be shown. The export now reads `capture_pages`, gives a
multi-page document a folder of its own (`page-01`, `page-02`), reports the
page count it actually wrote rather than the stored `page_count`, and flags
any disagreement between the two. Covered by `bench/e2e-settings.py` §7b,
which asserts the index and the archive account for each other exactly.

**And the defence worked on a live document, not in a unit test.** The model
misread the supplier ABN by a single digit — `85129887841` for
`85129887341` — and the pipeline said so by itself:

```
supplierAbnValid    false
complianceFailures  ['supplier_abn_invalid']
isTaxInvoice        false
gstAtRisk           1592.6600
reviewStatus        needs_review
finding             "The ABN 85129887841 fails the modulus-89 checksum,
                     so at least one digit was misread."
```

A cheap model got the most expensive field wrong, arithmetic caught it, the
GST was marked at risk rather than claimed, and a human was asked. That is
this document's premise, executed.

**A fifth defect the gate raised, since fixed.** The same document also
reported `lines_do_not_balance`: the lines summed to $15,926.65, which is
$1,592.66 short of the total — exactly the GST. Australian documents balance
two different ways, and the check only knew one:

| Convention | Lines sum to |
|---|---|
| Retail docket | the payable total — the printed prices already include GST |
| Commercial tax invoice | the total **minus** the GST — lines are ex-GST, GST shown once at the bottom |

A 40-line invoice read perfectly was flagged as short by precisely its own GST,
and the warning would have appeared on virtually every supplier invoice — which
is the fastest way to teach a reviewer to ignore warnings. `linesGap` now
accepts either reading and reports the smaller gap, so whichever convention the
document uses is the one the human is shown.

Verified by re-validating the gate document's **stored model output** — same
bytes, same reading, new validators, no new model call: `lines_do_not_balance`
is gone, `supplier_abn_invalid` still fires. One false positive removed, the
true positive kept.

**A sixth defect, found while proving the fifth — the most serious of the six,
now fixed.** Re-running extraction over a capture that already had a document
**failed outright**:

```sql
insert into documents (... ) values ( ... )
on conflict (capture_id) do nothing      -- documents_capture_unique
```

`documentId` is generated in application code before the insert. On the second
run the conflict clause skips the insert, the generated id is therefore never
persisted, and the line inserts that follow reference a document that does not
exist — a foreign-key violation that rolls back the whole run.

That is not a small bug. `docs/PLAN.md`'s second founding principle is
*"extraction is a versioned, replayable function of the image — better model in
six months ⇒ re-run over history"*, and §8.1 of this document leans on replay
as the reason a cheap model is safe. **Re-extraction is currently a
first-run-only operation**, so that promise is unimplemented rather than
merely untested.

Fixing the mechanics was the small half. The real work was that **migration
0009 states three guarantees and enforces only the narrowest of them**, and a
second one turned out to be guarding nothing at all: `locked_fields` had a
trigger refusing to let a machine release a lock, and **no code path anywhere
ever wrote a lock**. A re-extraction would have overwritten every correction a
human had made — which is precisely the data the review screen exists to
produce, and the input to the §9 Phase 5 flywheel.

Both halves are now implemented and tested against a real Postgres:

| Rule | Behaviour |
|---|---|
| A second run over the same capture | Updates the document in place, replaces the lines as a set, flips `current_run_id`. Both runs survive — the old reading is evidence. |
| A field a human has settled | `updateDocument` now records the field path in `locked_fields`; a later run keeps the human value, raises a `reextraction_disagrees_with_human` review task, and forces `needs_review`. |
| A document behind a **posted** transaction | Nothing is touched. The run is still recorded, and a `reextraction_after_posting` task asks a person. The books do not move because a model changed its mind. |

`apps/server/src/extraction/reextraction.test.ts` proves all three as the real
non-superuser role — the first draft of it was rejected by row-level security
for setting up its own fixtures, which is the test working before it ever ran.

### Phase 1 — DocDOM and the reading stage (4–6 weeks)

Intake, restoration, layout, reading order, **the OCR stage (§4.4): PP-OCRv5
detection and recognition behind our own adapter**, fusion, calibration,
DocDOM, and grounded extraction for the existing AU tax schema. The VLM path
stays, demoted to escalation, so there is a working reader throughout.

Plus the first two views (§5.3): **original** with provenance overlays, and
**annotated edit** — the scan underneath, an aligned editable text layer on
top, edits stored as L3 patches bound to fields. Both need only boxes and
text, which this phase produces anyway, and together they already deliver
"see the scan, edit the scan, keep the original".

**Gate:** on `au-receipts` and `au-invoices`, field-level accuracy **at or
above** today's frontier-only pipeline at **≤20% of its cost**, with every
value carrying a bbox and a calibrated confidence; anchor drift within
tolerance on the original, not just the restored copy; and the majority of
regions resolved without calling any hosted model at all.

Recognition brings metrics the field-level gate cannot see, and they are
measured from this phase on: **CER and WER per region**, **detection box IoU**
against the gold sets, and **confidence–error correlation**, which is what
makes D20 more than an intention.

#### First reading from an OCR stage we own (2026-09-11)

The stage exists and runs. `services/docai-engine` wraps **PP-OCRv5**
(Apache-2.0, both models) behind `POST /read`, returning DocDOM directly;
`packages/docai` holds DocDOM, the registry, the tier-0 PDF-text engine, the
sidecar adapter and the merge pipeline; `bench/ocr_score.py` scores text and
boxes rather than fields.

Measured against a synthetic page whose boxes come from the browser's own
layout engine, PP-OCRv5 mobile on **CPU**, stable across three repeats:

| Metric | Result |
|---|---|
| CER, whitespace-insensitive | **0.000 across all five legible regions** — every character correct |
| CER, strict | 0.089 — entirely box-segmentation spacing (`$1,042.60` read as four boxes), not misreads |
| Detection coverage | 5/6 regions covered at IoU ≥ 0.5, mean 0.845 |
| Abstention | 5 CORRECT, 1 MISSED, **0 CONFIDENT_WRONG** |
| Confidence–error correlation | `null` — undefined at n=5 with constant correctness, not a fabricated 0 |

#### And now running in the real pipeline, in shadow (2026-09-11)

The stage is wired into the worker. After a successful extraction it reads the
same `capture_pages` the model read, stores the DocDOM in object storage, and
records a pointer in `document_layouts` — **changing nothing about the
document**. On the two-page invoice from the Phase 0 gate:

```
page_count 2   span_count 443   unreadable 0   engine_ids {ppocr-v5}   shadow t
'Southern'  box=(150,196,133x38)  conf=0.992  calibrated=false
```

Shadow rather than replacement, deliberately: we have one measurement of a
recogniser reading printed text on a synthetic page, and none on a creased
thermal docket at 2am, which is the actual job. Shadow mode buys that evidence
at no risk to documents people already rely on, and the corpus it accumulates
is what makes the switch defensible later instead of hopeful.

**The bug that made it worth running rather than reasoning about.** The first
live attempt produced a layout with *zero* spans and every page marked
unreadable — beside a sidecar log full of `200 OK`. Two faults, stacked:

1. The adapter sent its JSON parameter as a `Blob`, which becomes a multipart
   *file* part; the service declares it as a form *field* and returned 422. The
   adapter's own tests passed throughout, because a fake server that accepts
   anything cannot tell a field from a file. There is now a test that reads the
   wire and asserts the part carries no filename.
2. With that fixed, the per-call timeout was capped at 10s — and PP-OCRv5 on
   CPU takes about 20s on a full-page PDF render. Every call aborted client
   side while the sidecar finished work nobody was waiting for. The cap was a
   number chosen before anyone had measured a page; the whole-stage deadline
   was always the real backstop.

Neither fault could have been found by reading the code, and neither broke
extraction — the shadow's safety boundary held through both, which is the one
property it was required to have.

#### Grounding: D16 stops being a principle (2026-09-11)

`packages/docai/src/grounding.ts` takes a value the model produced and finds
the spans on the page that say so. Run against the real two-page invoice — the
VLM's fields on one side, PP-OCRv5's 443 spans on the other, no second model
call:

```
GROUNDED   header.supplier        Southern Cross Logistics Pty Ltd  p1 (150,196 512x38)  conf=0.992
GROUNDED   header.supplier_abn    85129887341                       p1 (197,236 155x30)  conf=0.952
GROUNDED   header.issue_date      2026-08-14                        p1 (206,311 152x31)  conf=0.961
GROUNDED   header.payable_amount  17519.3100                        p2 (1382,230 112x32) conf=0.997
GROUNDED   header.tax_amount      1592.6600                         p2 (1412,184 83x33)  conf=0.994

grounding rate 100%
```

Every field now carries the box `docs/extraction-schema.json` has promised
since the beginning, the totals are correctly located on **page 2**, and the
confidence is the recogniser's weakest supporting character rather than the
model's opinion of its own output.

**And the same pass catches the hallucination.** Substituting the misread
`gemma4:31b` actually produced on this document:

```
UNGROUNDED header.supplier_abn    85129887841                       —  conf=0.000
grounding rate 80%
```

The page says `…341`; the model said `…841`; no span supports it. That is the
second independent mechanism to catch this one error — mod-89 rejects it as
arithmetic, grounding rejects it as unsupported — and **neither needed a
better model.** Two cheap readers disagreeing is the signal §4.5 argued for,
now demonstrated on a real document rather than a fixture.

**It now runs in the pipeline.** After the shadow OCR stage stores a layout,
the worker grounds the extraction against it and persists every field to
`document_field_grounding` — value, spans, box, page, weakest confidence. On
the live capture:

```
capture e1bba07b: grounding 80% — ungrounded: header.supplier_abn
```

Stored **advisory**, not enforcing: an ungrounded value raises no finding and
changes no `review_status` this round. The reason is the one
`lines_do_not_balance` taught this morning — we have a grounding rate from one
document and no idea of the false-positive rate on a creased thermal docket
where the OCR stage will legitimately miss text, and a review queue full of
spurious "unsupported value" warnings is how a reviewer learns to ignore
warnings. The table carries an `enforced` column, defaulting false, for when
the evidence justifies flipping it.

**A design error caught by two runs disagreeing.** The first wiring grounded
the supplier and ABN from the `parties` master record, which measured 100%;
grounding the *extraction's own values* measured 80%. `parties` is merged
across documents and corrected by humans, so grounding it asks whether the page
supports what the database ended up storing — a question nobody needs answered.
Grounding is a check on what the model said about these pixels, and it must be
fed the model's values. Had it shipped the first way, grounding would have
quietly validated the database against itself and reported a reassuring 100%
forever.

Three properties of the implementation worth stating, because each is a place
a looser version would claim success it has not earned:

- **Grounding reports; it does not decide.** An ungrounded value is returned
  unchanged, not deleted. The OCR stage can miss text, so "no span supports
  this" is evidence for `validators.ts` to weigh, not a verdict.
- **Dates match the printed form, not the ISO.** A docket says `14/08/26`;
  matching `2026-08-14` literally would ground almost no date at all. Day-first
  renderings only — accepting `08/14/2026` would quietly re-introduce the
  ambiguity the date validator exists to raise.
- **A run may not cross a line**, and is capped in length. A value assembled
  from half a page of unrelated digits is a coincidence with extra steps.

Two findings worth more than the numbers:

**PaddlePaddle 3.3.1 does ship a `cp313` wheel** — the Python 3.13 risk this
plan carried was stale. What is real is that its default CPU accelerator
(`enable_mkldnn=True`) throws a PIR/oneDNN conversion error on both PP-OCRv5
detection models, so the sidecar disables it. Real PP-OCRv5, one flag off,
no substitution.

**`ABSTAINED_CORRECTLY` has never been observed from the live engine, and
trying to arrange it produced a better lesson.** The outcome needs detection
to fire and recognition to fail. Two degradations were added to hunt that
window, and both missed it in opposite directions:

| Degradation | Result |
|---|---|
| Opaque overlay | Detector finds nothing — `MISSED`. A region never detected cannot be declared unreadable. |
| 2.6px blur | Also undetected — `MISSED`. |
| 1.4px blur | Detected, and **read correctly**: `CN88421-QX`. |
| `#c9c9c9` on white | Detected, and **read correctly**: `REF 7741-BD`. |

The middle two were labelled `illegible` when they were added, so the scorer
reported two `CONFIDENT_WRONG` results at 0.997 and 0.978 confidence — a
damning-looking number that was **entirely a ground-truth error**. PP-OCRv5
read text this document had asserted was unreadable. The labels were corrected
to what was measured.

That is the same class of defect as the gold set's invalid ABN, committed
after warning someone else about it, and the lesson generalises past both: **a
ground truth that asserts what an engine cannot do is a claim about the
engine, and has to be checked against the engine like any other claim.**

The engine's competence window is therefore wider than a CSS filter can
reliably probe, and the abstention case needs a genuinely degraded photograph
— which is what the `au-receipts` gold set (§8.2) is for. Until then the
metric §2 stakes the product's claim on is proven only against constructed
fixtures, and that gap is now understood rather than merely open.

Current standing, corrected labels, 8 regions: **CER 0.000
whitespace-insensitive across all 7 legible regions**, detection 7/8, one
`MISSED` (the opaque redaction), zero `CONFIDENT_WRONG`.

### Phase 1b — The device tier (2–3 weeks, *after calibration* — see D37)

The native module, the capability probe, the three model tiers, the delegate
ladder and the on-shutter quality gate (§4.9). Deliberately *after* the server
stage works: the device runs the same adapter against the same gold sets, so
building it second costs a fraction of building it in parallel.

**Revised sequencing (D36, D37).** This phase no longer overlaps Phase 2. It
starts once calibration (D20) lands, because the device tier's entire value is
its abstention and an uncalibrated one fails in both directions. And it ships
**iOS first**: 61% of Australian smartphone users are on iPhone, so Core ML is
the primary path and the low-end Android floor below remains the design target
rather than the first build target.

**Gate:** on the `device-matrix` floor device — low-end Android, no NPU — a
receipt reads end to end in under a second, within a stated accuracy delta of
the server tier, without thermal throttling across twenty consecutive
captures. Server-only fallback verified as a normal path, not an error.

> **Building this?** The ordered, ticket-level queue for this phase and every
> other gap found in the 12 September competitive scan is `docs/GAPS.md`.
> Lane D covers the device tier and states its preconditions.

### Phase 2 — Tables and business documents (4–6 weeks)

Table structure with spans, numeric reconciliation, the business-document
schemas, Office/HTML/email intake.

Plus the **twin** and **diff** views: style capture (L2 presentation), clean
plates, fit policies, metric-matched fonts, and both export flavours
(§5.6). This is the risky half of §5 and it is deliberately second — by now
the boxes are trustworthy, which is the precondition for redrawing anything.

**Gate:** ≥95% cell-level accuracy on `reports-charts` tables; statements and
POs classify and extract without a bespoke parser per layout; on
`layout-fidelity`, an unedited twin is visually indistinguishable from its
original and a single edit produces a single visual delta.

### Phase 3 — Figures and charts (3–4 weeks)

Chart classification, axis and legend recovery, series extraction to a data
table, geometric validation.

**Gate:** on `reports-charts`, series values within 2% of truth on bar and line
charts, with explicit abstention — not a guess — where they are not.

### Phase 4 — Forms and handwriting (4–6 weeks)

Field/label pairing, checkbox and signature detection, HTR, and a review flow
built on the assumption that this class needs human confirmation more often
than not.

**Gate:** measured and *published internally*, including where it is bad. A
known 82% with a reliable abstention signal is a shippable product; an
unmeasured 95% is not.

### Phase 5 — Portability and the flywheel (ongoing)

The `air-gapped` and `customer-vpc` profiles as real artifacts, the
fine-tuning export described in `docs/AI.md` §3 (consent-gated,
`ap-southeast-2`), and LoRA adaptation on the corrections the review screen
has been collecting since Phase 1.

This is where the advantage compounds: **nobody else has half a million
corrected Australian dockets.** The models are commodities; the labelled data
from a review screen people actually use is not.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Hallucination reaching the ledger** | Grounding (D16), engine disagreement, deterministic validators, calibrated abstention. The whole architecture is this mitigation. |
| **Scope: four classes at once** | Staged gates (§9). An ungated class routes to review; it never silently auto-accepts. |
| **GPU cost and ops burden** | T2 is the only GPU tier and is skippable per profile; T0/T1 cover most pages. Measure before scaling the pool. |
| **Model licences block on-prem** | Licence floor in the registry, enforced in CI (D23). |
| **Benchmark overfitting** | Gold sets split into dev and a **held-out set touched only at gates**; public benchmarks as the external check. |
| **Training on customer documents** | APP 6 consent gate, opt-in per workspace, exclusion by default — already specified in `docs/AI.md` §3.3, unchanged. |
| **Twin fidelity: redrawing looks wrong** | §5.2 — unedited content is never redrawn, so the risk surface is only edited runs. Measured as visual delta and edit locality (§8). |
| **An edited working copy passed off as the original** | Certified vs working copy are different artifacts; working copies carry visible and embedded provenance and the source hash (D28). |
| **DocDOM size on long documents** | JSON in object storage with a pointer and a small index in Postgres; never inlined into a row a list screen selects (§5.7). |
| **Font licensing in exports** | Metric-compatible faces with embeddable licences only, recorded in the registry alongside the model licence floor (D23). |
| **Device fragmentation** | Capability probe, three model tiers, a delegate ladder ending in server-only (D33), and a measured device matrix rather than one test handset. |
| **Native code cannot ship OTA** | Weights update OTA as data; the runtime does not. The seam is versioned so last quarter's runtime runs this quarter's weights (§4.9). |
| **Render performance on a phone** | One scene-graph renderer, tiled and virtualised; the device never builds a view per span (§5.8). |
| **Rebuilding what Docling already does** | Explicit non-goal. We adapt permissively licensed engines and own the pipeline, the contract and the verification (D14). |

---

## 11. Decisions

| # | Decision | Why |
|---|---|---|
| D14 | Build a **document engine** (`@snap/docai`), not a receipt extractor. Pipeline ours, model weights pluggable. | The pipeline, the contract and the verification are where the durable value is. |
| D15 | **DocDOM** is the contract between reading and meaning. | Decouples the two, makes engines swappable, makes provenance representable. Markdown cannot carry a bbox. |
| D16 | **No value without a span.** Ungrounded ⇒ null. | The structural fix for generative-OCR hallucination. |
| D17 | **Engine registry + deployment profile** gate routing on residency and network. | Makes an APP 8 breach unrepresentable rather than merely prohibited. |
| D18 | **Open-weight primary, frontier as escalation.** *(revises D2)* | Order-of-magnitude cost, and the only path that can also run air-gapped. |
| D29 | **We own the OCR stage**: detection and recognition, emitting text with coordinates and per-character confidence. The VLM becomes escalation, not the reader. | Grounding (D16), the twin (§5) and calibrated abstention (D20) are all localisation problems. An OCR-free architecture cannot produce a coordinate, so it cannot produce any of the three. |
| D30 | **Own the stage, rent the weights.** PP-OCRv5 (Apache-2.0) now; our own fine-tune when the corpus and the people exist. | We are not ready to train, and we do not have to be. Everything that compounds — calibration, grounding, the corpus, the eval — is in the stage, not the weights. |
| D32 | **The phone is an engine tier, not a camera.** It runs the same detection/recognition stage one size smaller — advisory only, stored as `engine = 'device'`. | Gives a quality gate that fires while the receipt is in hand, offline capture, an instant provisional read, and a free agreement signal against the server run. |
| D33 | **Device capability is probed, and server-only is a valid outcome.** Tier and delegate are chosen at runtime; the weakest phones fall back rather than fail. | "Any phone" is a promise about the floor. A fixed model size breaks it at both ends — too slow on the floor, wasteful on the ceiling. |
| D31 | **Open weights self-hosted are a residency non-event.** Where a model was trained is irrelevant when no document leaves `ap-southeast-2`; hosted APIs are the only residency question. | Otherwise "no Chinese models" becomes a rule that blocks the Apache-2.0 weights we run ourselves while permitting the hosted API that actually exports the data. |
| D19 | **Evaluation is a product surface**: committed gold sets, public-benchmark parity, CI regression gates. | Same discipline as the 217-test tax engine, applied to reading. |
| D20 | **Calibrated abstention** over raw accuracy; report the coverage–risk curve. | The number a finance team actually buys is silent-error rate. |
| D21 | On-device stays a **quality gate and provisional preview**. *(confirms D1, D3)* | On-device extraction is unreplayable and kills backfill. |
| D22 | Air-gap is a **v1 design constraint, a later SKU**. | Cheap now, impossible to retrofit, unprofitable to productise before a buyer exists. |
| D23 | **Licence floor**: only Apache-2.0/MIT weights in a redistributable image, enforced in CI. | Procurement finds this; better that CI finds it first. |
| D24 | The output is a **digital twin**, not an extraction. The document is laid out as itself, editable, with the original beneath it. | A user checks a total where it was printed. A field list makes them re-read their own receipt in an order it was never written in. |
| D25 | **Edits are append-only patches** against node ids. L0 is never written twice; the reconstruction is `L2 + L3`. | Gives undo, audit, machine-vs-human diff, and keeps the legal record untouched — all from one mechanism. |
| D26 | **Never redraw what nobody changed.** Only edited runs are synthesised. | Turns fidelity from a hard rendering problem into a cosmetic one confined to edits, and makes the visual diff *be* the change log. |
| D27 | **A field is a pointer to a node**, not a copy of its value. | Two copies — a form and a page — drift the moment either is touched. Bindings make that unrepresentable. |
| D28 | **Certified copy and working copy are different artifacts.** An edited export can never present itself as the original record. | A document that can impersonate a tax record is a forgery surface. Cheapest to close before the first one exists. |
| D34 | **Track PaddleOCR's current generation, not the one we started on.** PP-OCRv6 now; re-evaluate each release against the gold sets before adopting. | The weights are rented (D30), so staying current is a version bump and a bench run, not a rewrite. Being a generation behind inside a library we already pin is pure forgone accuracy — and detection, the thing v6 improves most, is our weakest measured number (§8.1). |
| D35 | **Reading accuracy is reported whitespace-insensitively for money and identifier fields**, with strict CER kept beside it. | §8.1 measured strict CER 0.0661 and whitespace-insensitive 0.0000 on the same seven regions: PP-OCRv5 read `$1,042.60` as `$ 1 , 042.60`. Token boundaries are a convention of the engine, not a misreading, and a headline that says 6.6% error when the characters are perfect will get the stage rejected for the wrong reason. Whitespace is not ignored where it is semantic — it is normalised only inside a matched field. |
| D36 | **The device tier ships iOS first.** Core ML is the primary path; the low-end Android floor (§4.9) stays the design target but is sequenced second. | 61% of Australian smartphone users are on iPhone, and premium devices are more than half of all AU sales. §4.9 says "not a recent iPhone" and spends its budget on a 2–3 GB Android that is, in this market, uncommon and shrinking. Designing for the floor is right; *building* for it first serves the smallest slice of the actual customer base. |
| D37 | **Calibration (D20) is a prerequisite for the device tier, not a parallel workstream.** | The whole value of an on-device read is its abstention — "I cannot read the total" while the receipt is in hand. An uncalibrated abstention fails both ways: too eager and it nags users into deleting the app, too shy and it gives false comfort on a receipt they have already walked away from. Today the engine self-reports `calibrated: false` and the 0.8 cutoff is a placeholder in code. |

---

## 12. Decisions revised

- **D2** (extraction engine = Claude Haiku → Sonnet escalation) is **revised by
  D18**. Frontier models stay — as the escalation tier, and as the quality
  reference the open tiers are scored against — but not as the per-page
  default.
- **D13** (LLM residency, Bedrock `ap-southeast-2`) **stands**, and is
  strengthened: it becomes enforced by the profile mechanism rather than by
  configuration discipline.
- **`docs/AI.md` §2.1**'s benchmark table remains valid for what it measured —
  whole-page frontier reading of a degraded docket. It is now the *upper bound*
  the tiered pipeline is measured against, not the pipeline itself.
- **`docs/extraction-schema.json`** becomes true: the bbox it has always
  promised is delivered by DocDOM in Phase 1 — by the OCR stage (D29), which
  is the only thing that can produce one.
- **D14's first draft said "engines pluggable and partly borrowed", and this
  document argued against building our own reader.** That was right about
  training weights and wrong about the stage. Recognition is not only a
  quality question; it is where coordinates come from, and coordinates are
  what this product is built on. D29 and D30 separate the two: the stage is
  ours now, the weights are ours later.
- **D30's "PP-OCRv5 now" is superseded by D34: PP-OCRv6 now.** The principle
  is unchanged — own the stage, rent the weights — and the point of renting
  is exactly that the tenancy is cheap to move. §2 records what that move is
  worth and what it costs (a version bump and a bench run).
- **§4.9's device-tier framing is revised by D36.** "'Any phone' means a
  low-end Android with 2–3 GB of RAM … not a recent iPhone" remains the right
  *design floor* and every lever in that table stands. What changes is build
  order: Core ML first, because the Australian market is 61% iOS and the
  budget Android floor here starts around 8 GB, three to four times the
  device the section is written against.
- **§9's Phase 1b is resequenced by D37**, from "overlaps Phase 2" to "after
  calibration". Nothing in the device tier is worth shipping before the
  abstention it depends on means something.
