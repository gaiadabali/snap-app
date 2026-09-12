# Phase 1 contract — the OCR stage

**Frozen interface.** Three workstreams build against this in parallel.
Context: `docs/OCR.md` §4.4 and §9 Phase 1.

Today there is no OCR stage. A vision-language model is handed the whole page
and asked for JSON — the architecture the literature calls **OCR-free**. It
never locates anything, so it cannot produce a coordinate, and three things in
the plan depend on one: grounding (D16), the editable twin (§5), and calibrated
abstention (D20).

We are building the stage we skip: **detection and recognition that we own**,
emitting text with boxes and per-character confidence. The VLM is demoted from
*the reader* to *the escalation path for regions the recogniser flags*.

**We are not training weights** (D30). The stage is ours; the weights inside it
are borrowed, open and swappable.

---

## 1. What already exists — build on it, do not redo it

- **`packages/docai`** — `DocDOM` (`src/docdom.ts`) and the engine registry
  (`src/registry.ts`), written and typechecking. **This is the frozen
  contract.** If something in it is wrong, say so and stop; do not work around
  it.
- **`apps/server/src/extraction/pdf.ts`** — PDF demux with a digital text layer
  already detected (`pdf_native` vs `pdf_render`). That is **tier 0** and it is
  done; do not reimplement it.
- **`apps/server/bench/`** — a real per-field harness with a 4-document corpus,
  abstention scoring and median latency.

## 2. File ownership — do not edit outside your lane

| Lane | Owns |
|---|---|
| **E — sidecar** | `services/docai-engine/**` (new) |
| **F — adapter** | `packages/docai/src/engines/**`, `packages/docai/src/pipeline.ts` (new files only) |
| **G — eval** | `apps/server/bench/**` |

Nobody edits `packages/docai/src/docdom.ts` or `src/registry.ts`. Nobody edits
`apps/server/src/**` this round — wiring the stage into the worker is mine,
after all three land.

---

## 3. The runtime decision

Everything that makes this stage good — detection, recognition, dewarp, layout
— lives in the **Python** CV ecosystem. PaddleOCR is Python-first. There is no
credible TypeScript equivalent, and `docs/PLAN.md` D6 chose TypeScript before
anyone proposed running vision models in-house.

**Decision: a Python sidecar behind an HTTP seam.** TypeScript keeps the
pipeline, DocDOM, grounding, validators and the tax engine. Python holds only
model adapters. This amends D6 rather than overturning it, and it is the reason
`Engine` in the registry is an async interface — the seam was designed for a
process boundary before we knew we needed one.

The cost is honest and should be stated wherever this is described: two
runtimes to deploy, and a heavier air-gapped image.

---

## 4. Lane E — the sidecar (`services/docai-engine`)

A small Python HTTP service wrapping PaddleOCR.

```
POST /read
  multipart, and the FIELD NAMES ARE PART OF THE CONTRACT:
    image  — the page bytes
    params — JSON { pageNumber, capabilities: ["detect","recognise"], region? }
  → 200 { blocks: [...], unreadable: [...], engine: "ppocr-v5", timings: {...} }
GET  /health → { ok, models: [{id, licence, loaded}], device: "cpu"|"cuda" }

Listens on 127.0.0.1:8088.
```

The first draft of this contract left the field names and the port unstated.
The two lanes picked `params` and `meta` respectively and agreed on nothing
until they were run together. Naming them is cheaper than finding out twice.

**The response must be DocDOM-shaped** — `blocks` / `lines` / `spans` with
`box` and `provenance` exactly as `packages/docai/src/docdom.ts` defines them.
The adapter must not have to translate a foreign shape; that translation is
where coordinate bugs live.

Rules:
- **Boxes in original page coordinates.** If you restore the image before
  reading (deskew, dewarp), you must map boxes back and report the transform.
  A box that is right on your derivative and wrong on the original is the one
  failure this whole phase exists to avoid.
- **Per-character confidence where the model reports it**, and
  `calibrated: false` until someone actually calibrates it. Claiming calibration
  we have not done is worse than admitting we have not.
- **Abstain rather than guess.** A region you cannot read goes in `unreadable`
  with a reason — never an empty string, never a plausible filler.
- CPU must work. GPU is an optimisation, not a requirement.
- Pin versions. Record each model's licence in `/health`; D23 sets an
  Apache-2.0/MIT floor for anything redistributable.

**Verify PaddleOCR actually installs on this machine before building around
it** (Python 3.13 is present; `paddlepaddle` may not support it). If it does
not, say so immediately with the exact error and stop — do not silently
substitute a different engine, and do not fake a response. A working sidecar
around a different Apache-2.0 engine is an acceptable outcome *if you propose
it and say why*; a sidecar that pretends to run PaddleOCR is not.

## 5. Lane F — the adapter and pipeline (`packages/docai`)

1. `src/engines/sidecar.ts` — an `Engine` implementation that calls lane E's
   HTTP service, with a timeout, one retry, and a clear error when the sidecar
   is not running. Its `EngineSpec`: `residency: 'self-hosted'`,
   `requiresNetwork: false` (a loopback sidecar is not egress — say so in a
   comment, because it looks wrong at a glance), `weightsLicence: 'apache-2.0'`,
   `tier: 1`.
2. `src/engines/pdf-text.ts` — the **tier 0** engine, wrapping the text layer
   `apps/server/src/extraction/pdf.ts` already extracts. Free and exact. It
   needs no network and no model; `weightsLicence: 'none'`.
3. `src/pipeline.ts` — `read(pages, engines, profile): Promise<Document>`:
   route each page to the cheapest capable engine via `chain()`, merge partial
   documents, and where two engines read the same region, record the
   disagreement in `provenance.disputedBy` rather than silently picking one.
4. Tests with a **fake engine**, not a live sidecar: merge order, tier
   escalation, profile filtering (an air-gapped profile must not yield an
   external engine), and licence-floor violations.

Do not import from `apps/server`. `packages/docai` is a function from bytes to
a document; a package that reaches into an app is not one.

## 6. Lane G — measuring the stage

The current harness scores *fields*. This stage produces *text and boxes*, and
those need their own numbers:

- **CER and WER** per region against ground truth.
- **Detection IoU** — did we find the text at all, and where.
- **Abstention quality** — an unreadable region correctly declared beats a
  confident wrong reading, and must score that way.
- **Confidence-versus-error correlation** — the input to calibration (D20).
  Without it, `calibrated: false` never becomes true.

Add per-region ground truth to the corpus manifest for at least one document.
Boxes are laborious to label by hand: generating a synthetic page where the
boxes are known exactly by construction is a legitimate and preferred route,
as `gen_corpus.py` already does for values.

**Invent nothing.** If the sidecar is not running, report "not run" and say so.

---

## 7. Definition of done, all lanes

- `pnpm -r typecheck` clean; `test/boundaries.test.ts` still passes.
- Comments explain **why**, matching the register of the surrounding code.
- No secret in a log, an error, or a commit.
- Report what you did NOT do, what you could not verify, and anything that
  belongs in another lane.
