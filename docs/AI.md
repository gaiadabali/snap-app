# AI strategy

Two phases. Phase 1 rents cheap models and makes them safe with deterministic
code. Phase 2 fine-tunes our own from the corrections phase 1 collects.

Every number in this document is measured, and the harnesses are committed so
they can be re-run when a model changes underneath us. Nothing here is chosen
on reputation.

---

## 1. The principle

**A model reads. Deterministic code decides.**

This is not a stylistic preference; it is what the measurements force. A model
is excellent at reading a creased thermal docket in bad light and unreliable at
arithmetic, dates and jurisdiction-specific thresholds — and it is fluent
enough that a wrong answer looks exactly like a right one.

So the model never produces a figure that reaches the ledger or the user
unchecked:

| Task | Model's job | Our job |
|---|---|---|
| Extraction | Read the fields, and say when it cannot | Validate arithmetic, dates, ABN checksum, ATO elements |
| Chat | Understand the question, phrase the answer | Supply every figure via a tool |

The consequence is that a **cheap** model is safe to use, because being wrong
is caught rather than shipped.

---

## 2. Phase 1: rented models

### 2.1 Vision — scored on a degraded docket

`apps/server/bench/compare.py`. Ground truth known exactly; the image is dim,
motion-blurred, creased, with glare across the total — a photograph from a
truck stop at 2am, not a flat scan. Eight checkable fields.

| Model | Origin | Score | Latency | Output tokens |
|---|---|---|---|---|
| **minimax-m3** | MiniMax (CN) | **8/8** | 4.7s | 273 |
| **kimi-k3** | Moonshot (CN) | **8/8** | 7.9s | 381 |
| qwen3.5:397b | Alibaba (CN) | 8/8 | 21.7s | 871 |
| kimi-k2.6 | Moonshot (CN) | 7/8 | 31.2s | 952 |
| gemma4:31b | Google | 8/8 | 3.8s | 140 |
| mistral-large-3 | Mistral (FR) | 8/8 | 5.6s | 151 |
| glm-5.x | Zhipu (CN) | — | — | **no vision: HTTP 400** |
| deepseek-v4-* | DeepSeek (CN) | — | — | **no vision: HTTP 400** |
| gpt-oss:120b, nemotron-3-super | — | — | — | no vision |

**Decision: `minimax-m3` primary, `kimi-k3` escalation, `gemma4:31b` fallback.**

GLM and DeepSeek are text-only and cannot do this job at all — worth knowing
before building on either.

### 2.2 Chat — scored on Australian tax rules

`apps/server/bench/chat.py`. Five questions whose answers decide money: GST as
1/11 rather than 10%, the $82.50 tax-invoice threshold, the $1,000 buyer
identification threshold, five-year retention, and home-to-work travel.

**No model scored better than 4/5 unaided.** The consistent misses were the two
dollar thresholds. Several answered a GST question by taking ten per cent of a
GST-inclusive total. One offered "IRD or ATO" — unsure which *country* it was
answering for.

Two caveats against my own harness, recorded because they change the reading:
`qwen3.5` reaches the right answer but needs ~2,300 reasoning tokens and was
truncated at 700; `gpt-oss` declined to assume Australia and asked which
country, which is defensible behaviour that the scorer punished.

### 2.3 The same questions, with tools

`apps/server/bench/toolcall.py`. The figures are supplied as functions
(`src/ai/tools.ts`) and the system prompt forbids stating a figure from memory.

| Model | Unaided | With tools | Called the right tool |
|---|---|---|---|
| **glm-5.3** | 3/5 | **4/4** | 4/4 |
| **glm-5.3-flash** | 4/5 | **4/4** | 4/4 |
| minimax-m3 | 4/5 | **4/4** | 4/4 |
| kimi-k3 | 3/5 | 3/4 | 4/4 |
| deepseek-v4-flash | 3/5 | 2/4 | 4/4 |

**Decision: `glm-5.3` for chat, `glm-5.3-flash` when latency matters.**

DeepSeek is **excluded from chat**: it called the tools and then failed to
report what they returned. A model that ignores the authoritative answer it
just requested is worse than one with no tools, because the wrong figure now
appears sanctioned.

### 2.4 What the tools cover

`src/ai/tools.ts`, 58 tests. Each returns a phrased answer, the underlying
figures, and the rule's source for the footnote the UI shows:

- `gst_on_purchase` — 1/11 of the inclusive amount, minus any GST-free portion
- `gst_on_sale` — 10% added; deliberately a separate function so the two
  directions can never be confused at a call site
- `tax_invoice_requirements` — both thresholds and the seven required elements
- `check_abn` — modulus-89, the same check the database enforces
- `current_rates` — from the tax engine's rate set, so it is never last year's
- `retention_period` — five years, plus the true-and-clear-reproduction rule

Tool *descriptions* are written for the model and all begin "Call this when…",
because the failure mode is a model answering from memory instead of calling
the function that has the real number. A test enforces that phrasing.

### 2.5 Routing

`src/ai/router.ts`. A task names a **capability**, not a model. Escalation goes
to a *stronger* model rather than retrying the same one — at temperature 0, a
model that produced unparseable output produces it again; the only thing that
changes the answer is changing the reader.

### 2.6 Provider

Development runs against the shared Ollama Cloud account, which is
weekly-rate-limited and **must not become a production dependency**.

Production is Claude on Bedrock in `ap-southeast-2`, per decision D13, so
inference stays in Australia and a receipt is not a cross-border disclosure
under APP 8. `BedrockClaudeProvider` currently **throws rather than falling
back** to the development provider: a pipeline that quietly ships Australian
tax records offshore because a credential was missing is exactly the failure
APP 8 exists to prevent.

---

## 3. Phase 2: our own model

### 3.1 The flywheel already exists in the schema

Fine-tuning needs labelled examples, and this app manufactures them. Every
correction on the review screen produces a training triple, and all three
parts are already stored:

| Part | Where | Since |
|---|---|---|
| The image | `captures.original_storage_key` | 0003 |
| What the model said | `extraction_runs.raw_response` | 0003 |
| What the human corrected it to | `document_field_corrections` | 0004 |

That is the dataset. **The review screen is the labelling tool** — which is why
it is worth the care it has had.

What is missing is only the export: a job that joins those three, filters to
consenting tenants (below), and emits JSONL.

### 3.2 Base models

Fine-tuning is LoRA on a consumer-grade base, not training from scratch.

- **Extraction (vision):** `Qwen2.5-VL-7B` or `Qwen3-VL-8B`. Apache-2.0,
  genuinely strong at document OCR, LoRA-tunable on a single 24 GB card. Note
  the `qwen3.5:397b` benchmarked above is a rented frontier model, not a
  tuning base — the 7–8B siblings are the target.
- **Chat:** **Hermes** is a reasonable pick here. It is a text-only fine-tune
  family, so it cannot do extraction, but Hermes 4 is specifically strong at
  tool calling — which is exactly and only what our assistant needs, since it
  is forbidden from knowing any figures itself.

Rough expectation: a few hundred examples buys format adherence; 2–5k buys
accuracy on Australian docket layouts that no general model has seen.

### 3.3 The legal gate — read this before collecting anything

Using customer receipts to train a model is a **secondary use of personal
information** under Australian Privacy Principle 6. It is not covered by having
collected the receipt for bookkeeping.

Three requirements, which have to be designed in rather than retrofitted:

1. **Opt-in consent per workspace**, recorded with a timestamp and the version
   of the wording consented to. Not a buried clause in terms of service.
2. **Exclusion by default.** The export job filters to consenting tenants, and
   the default for a new workspace is out.
3. **De-identification where possible** — a receipt image carries a merchant, a
   date, an amount, sometimes a partial card number and a person's name. Train
   on crops or redact where the field is not needed for the task.

If training runs offshore, **APP 8 applies as well** and the cross-border
disclosure needs its own basis. Training in `ap-southeast-2` avoids the
question entirely, which is the same reason inference lives there.

---

## 4. Re-running the evidence

```
cd apps/server/bench
python compare.py     # vision accuracy on the degraded docket
python chat.py        # tax rules, unaided
python toolcall.py    # tax rules, with tools
#   the images: python hard.py regenerates the degraded docket from receipt.html
#   the key:    OLLAMA_ENV_FILE, or OLLAMA_API_KEY in the environment
pnpm --filter @snap/server extract <image>   # the full pipeline
pnpm --filter @snap/server test              # 58 validator + tool tests
```

Re-run `compare.py` whenever a model is added to the router. A registry of
untested models is a registry of guesses.
