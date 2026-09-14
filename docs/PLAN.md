# Snap Apps — Architecture & Delivery Plan

**Status:** draft for review · **Date:** 2026-09-09 · **Market:** Australia only
**Shape:** API-first personal/business finance tracker with OCR document capture, local + cloud
storage, accounting-software sync, and Australian tax export.

> **Reading order for the extraction pipeline.** §4 here is widened by
> `docs/OCR.md`, whose §12 records which decisions below it revises — D2 (engine
> choice) and D3 (on-device scope) in particular. **`docs/GAPS.md` is the ordered
> build queue** for both, with per-ticket acceptance criteria.

---

## 1. What this is

Three products sharing one schema:

1. **A capture layer.** Photograph receipts, tax invoices, credit notes → normalised, auditable records.
2. **A finance tracker.** A real double-entry ledger. Every scan can become a posted transaction;
   every transaction keeps its source image as legal evidence.
3. **An export/sync layer.** Xero (and MYOB/QuickBooks), local backup, and Australian tax packs —
   BAS worksheets and myDeductions-shaped returns data.

The database is the product. The schema — not the UI — is what has to be right the first time.

### Four principles that drive every decision below

1. **The original image is immutable and is the legal record.** The ATO accepts electronic copies of
   receipts only where they are a *true and clear reproduction* of the original. So we keep original
   bytes forever (until retention expiry) and derive a separate normalised copy for the model. We
   never overwrite or aggressively recompress the original.
2. **Extraction is a versioned, replayable function of the image.** Better model in 6 months ⇒ re-run
   over history. This is why extraction cannot live on the device.
3. **The ledger is double-entry and provably balanced.** Sum of splits per posted transaction = 0,
   enforced by the database, not by application discipline.
4. **Every field carries provenance.** Value, confidence, source run, and who corrected it.

---

## 2. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Extraction location | **Server-side only** | On-device OCR is unreplayable; kills backfill. Fatal for an API-first DB. |
| D2 | Extraction engine | **Claude Haiku 4.5 vision → Sonnet 5 escalation** | ~$6/1k scans realtime, ~$3/1k batched. Beats prebuilt Document AI (~$10/1k) with a schema you own. |
| D3 | On-device OCR | **Pre-flight quality gate only** | ML Kit (Android) / Vision (iOS) rejects blurry or non-document frames before upload. Never a data path. |
| D4 | Local + cloud | **Local SQLite as a real store, synced to Postgres** | Requirement. Cloud Postgres is source of truth; device holds a full working replica. |
| D5 | Sync engine | **PowerSync** (self-hostable) | Postgres CDC → filtered local SQLite + upload queue. Mature RN SDK. Alternative: WatermelonDB if you want zero vendor and will own the protocol. |
| D6 | Backend language | **TypeScript** (revised — see §2.1) | The 165-golden-test AU deduction engine in `free-tax-returns` is TS. Porting tax maths is a correctness risk Go's footprint does not pay for. |
| D7 | Database | **PostgreSQL 17+** | RLS, `NUMERIC`, JSONB, deferrable constraint triggers, `SKIP LOCKED` queue, generated columns. |
| D8 | Ledger model | **Double-entry, transaction + splits, sum-zero** | The only way to guarantee the books are consistent. Also what Xero expects on the other side. |
| D9 | Job queue | **Postgres `FOR UPDATE SKIP LOCKED`** | Nothing extra to operate. Revisit above ~50 scans/sec. |
| D10 | Mobile | **Expo SDK 57 + Expo Router + expo-camera** | EAS OTA updates matter for a capture UX you will tune weekly; TS shares API types; PowerSync has a first-class RN SDK. |
| D11 | Semantic model | **PINT A-NZ (Peppol) business terms + AU tax codes** | PINT A-NZ has been the mandatory AU/NZ e-invoicing spec since 15 May 2025. Tax codes mirror Xero/MYOB. |
| D12 | Object storage | **S3-compatible, `ap-southeast-2`, private + SSE-KMS** | AU data residency; short-TTL presigned URLs only. |
| D13 | LLM residency | **Claude on Bedrock `ap-southeast-2`** | Keeps inference in Sydney, avoiding an APP 8 cross-border disclosure problem. See §7. |

### 2.1 Why D6 changed from Go to TypeScript

The first draft of this plan recommended Go on footprint and concurrency grounds. Finding
`free-tax-returns` changes the calculation, and the reversal is worth stating plainly:

- **The crown jewel is TypeScript.** `src/engine/` holds an FY-versioned rate set
  (`rates/fy2026.ts`, TD 2025/4), 19 occupation profiles, per-label calc modules
  (`calc/d1-car.ts` … `calc/d9-d14.ts`) and **217 tests** (165 at the time that doc was written). Re-implementing that in Go means
  re-deriving tax arithmetic that is already pinned by tests — and doing the annual rate update twice,
  forever.
- **Go's advantage here is smaller than it looked.** The pipeline is dominated by LLM latency, not
  CPU. The one CPU-bound step is image normalisation, and `sharp` (already a dependency) is libvips
  bindings — the same native library Go would reach for via `govips`.
- **Infrastructure already exists.** `better-auth` answers open question O2, Upstash rate limiting
  answers tier enforcement, Drizzle owns migrations, Postgres is already the database.

**Kept in reserve:** if the extraction worker ever becomes throughput-bound, it is a queue consumer
behind a narrow contract — the single cheapest component in the system to rewrite in Go or Rust.
Do that on measurement, not on principle.

### Rejected, with reasons

- **Go for the whole backend** — see §2.1. Right instinct on footprint, wrong trade once a tested
  TypeScript tax engine is in scope.
- **NestJS** — heaviest option in memory and cold start for an image/LLM pipeline; plain
  TypeScript with a worker process gets the reuse without the framework weight.
- **Rust (axum + sqlx)** — genuinely better on footprint and guarantees. Recommended *only* if you
  already write Rust daily; async Rust friction will otherwise cost more than it saves at this scale.
- **Single-entry / "transactions with a category" model** — simpler for a week, then GST reporting,
  transfers, refunds, and Xero reconciliation all become special cases. Rejected on principle 3.
- **Azure Document Intelligence / Google Invoice Parser** — deterministic per-field confidences are
  nice, but rigid schemas and weaker performance on crumpled phone photos, at higher cost.
- **On-device-only extraction** — free, but you hand-write parsers per vendor layout forever.
- **Full CRDT sync** — unnecessary. Extraction fields are server-authoritative; user-edited fields
  are last-write-wins per field. No merge algebra needed.

---

## 3. Architecture

```
┌──────────────────────────────────────────┐
│  Expo RN app                             │
│  camera → quality gate → outbox          │
│  local SQLite (full replica)  ←─ PowerSync
└────────┬─────────────────────────────────┘
         │ POST /v1/captures  (presigned PUT + Idempotency-Key)
         ▼
┌─────────────────────────────────────────────────────────┐
│  TypeScript API  (@snap/db · Drizzle · pg)               │
│  auth · RLS session · idempotency · dedup               │
│  ledger posting · BAS/tax reports · export jobs         │
└────┬──────────────────┬──────────────────┬──────────────┘
     │                  │                  │
     ▼                  ▼                  ▼
┌──────────┐   ┌──────────────────┐   ┌──────────────────┐
│ S3 ap-se-2│   │ Postgres         │   │ Xero / MYOB /    │
│ original  │   │ captures         │   │ QuickBooks       │
│ + derived │   │ extraction_runs  │   │ (rate-limited    │
│ KMS       │   │ documents/lines  │   │  outbound queue) │
└────┬─────┘   │ accounts         │   └──────────────────┘
     │         │ transactions     │
     │         │ splits · tax_codes│
     │         │ audit_log · jobs │
     │         └────────┬─────────┘
     ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  TS worker  (SKIP LOCKED, runs under tsx/tsup)          │
│  1. keep original · derive normalised (libvips)         │
│  2. Claude Haiku 4.5 vision + strict JSON schema        │
│  3. DETERMINISTIC VALIDATORS  ← biggest accuracy lever  │
│  4. escalate to Sonnet 5 on failure                     │
│  5. write document + provenance                         │
│  6. propose a balanced draft transaction                │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Workspace layout — thin app, heavy server

```
apps/
  mobile/            Expo RN. Capture, review, read. Nothing else.
  server/            Capture intake, extraction, ledger, tax engine, exports.
packages/
  api-contract/      Wire TYPES only, zero runtime deps.  ← mobile's only workspace dep
  db/                Migrations + Drizzle + RLS helpers.  ← SERVER ONLY
  tax-engine/        AU deduction engine, 217 tests.      ← SERVER ONLY
```

**Enforced, not documented.** `test/boundaries.test.ts` walks the dependency closure and
fails the build if `@snap/mobile` can reach `@snap/db` or `@snap/tax-engine` — directly or
transitively — and checks that `api-contract` has no dependencies and imports nothing.

The reason is not bundle size. **The engine's ATO rates change every 1 July.** If the engine
shipped inside the app, a rate change would need an App Store release, and every user who
had not updated would silently compute the wrong deductions for the new financial year.
Server-side, the annual rate update is a deploy. `@snap/db` is excluded for a different
reason: it carries the `pg` driver and the tenant-isolation helpers, and neither belongs on
a device an attacker can hold in their hand.

### The four layers

**Capture** (immutable image) → **Extraction run** (versioned, many per capture) →
**Document** (curated, one current) → **Transaction** (posted ledger entry, references the document).

`documents.current_run_id` points at the winning run. Re-running extraction inserts a new run and
flips the pointer; nothing is destroyed. A posted transaction is *never* silently rewritten by a
re-extraction — it raises a review task instead. That boundary is what keeps the books trustworthy.

---

## 4. Extraction pipeline

> **Widened by `docs/OCR.md` (2026-09-11).** This section describes the AU
> receipt extractor. The general document engine — PDFs, multi-page, layout,
> tables, charts, forms, handwriting, tiered open-weight routing and
> deployment profiles — is planned there, and revises D2. Decisions D14–D23
> live in that document.

### Cost model (against current pricing)

A receipt photo capped at 1568 px ≈ 1,500–2,200 image tokens.

| Tier | Model | In/Out $/MTok | Per scan | Per 1,000 |
|---|---|---|---|---|
| 1 (primary, ~85%) | Claude Haiku 4.5 | $1 / $5 | ~$0.0059 | **~$6** |
| 1 batched (backfill) | Haiku 4.5 + Batch API | 50% off | ~$0.0030 | **~$3** |
| 2 (escalation, ~15%) | Claude Sonnet 5 | $2 / $10 | ~$0.0114 | ~$11 |
| **Blended realtime** | | | | **~$7** |

Levers already in the design: a cached system prompt + schema prefix (~90% off those input tokens),
Batch API for backfill, and `output_config.effort` tuned down for tier 1.

### Schema enforcement

`strict: true` tool use (or `output_config.format`) against a versioned JSON Schema — see
`docs/extraction-schema.json`. Two rules the prompt enforces:

- Every field returns `{value, confidence, bbox}`.
- **The model returns `null` with a reason rather than guessing.** A confident wrong ABN is far worse
  than a missing one — it silently creates an unclaimable GST credit.

### Deterministic validators (Go, not the LLM)

Costs nothing, catches more than a bigger model would. Runs after every extraction:

| Check | Rule |
|---|---|
| ABN format | mod-89 checksum. Fails ⇒ store but flag `abn_valid = false`, never `verified`. |
| ABN identity | ABR Lookup web service (free) ⇒ confirm legal name + **GST registration status**. |
| GST arithmetic | `tax_exclusive_amount + tax_amount == tax_inclusive_amount` |
| GST rate | All-taxable doc ⇒ `tax_amount ≈ tax_inclusive_amount / 11` (AU GST is 1/11 of the inclusive price) |
| Line sum | `Σ line_net_amount == line_extension_amount` |
| Cash rounding | AU rounds cash to 5c ⇒ ±$0.02 tolerance, difference recorded in `rounding_amount` |
| Mixed tax | Groceries mix GST-free fresh food with taxable packaged goods ⇒ `document_tax_subtotals` must reconcile per category, not just in total |
| ATO completeness | The 7 required elements ⇒ sets **`is_tax_invoice`**, which gates GST credit claims (§6) |
| Dates | `issue_date` not in the future, not more than 10 years past |

Any failure ⇒ escalate to tier 2. Still failing ⇒ `needs_review`.

### Routing

- All fields ≥ 0.95 **and** all validators pass ⇒ `auto_accepted`, draft transaction proposed
- Otherwise ⇒ `needs_review`, with the specific failed check attached

### Deduplication (three independent signals)

| Signal | Action |
|---|---|
| `sha256` of original bytes | Exact re-upload ⇒ `409` + pointer to the existing capture (idempotent, not an error) |
| `phash` Hamming distance ≤ 6 | Soft-flag "possible duplicate" |
| Business fingerprint `(supplier_abn, document_number, issue_date, payable_amount)` | Group via `dedup_group_id` — **flag, never auto-merge**. Two identical $4.50 coffees on one day are both real. |

---

## 5. The ledger

Full annotated DDL in `docs/data-model.sql`.

### Model

`accounts` (chart of accounts) · `transactions` (header) · `transaction_splits` (lines) · `tax_codes`.

**Sign convention:** debits positive, credits negative. Assets and expenses increase positive;
liabilities, equity, and income increase negative. `SUM(splits.amount) = 0` per transaction.

**Enforcement:** a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `transaction_splits`,
evaluated at commit and **only for `status = 'posted'`**. Drafts can sit half-built, be edited, and be
deleted without ever tripping the balance check. This is the standard pattern and it is the reason
drafts and correctness can coexist.

> **Verified against PostgreSQL 17.** `docs/data-model.sql` was executed on a clean Postgres 17
> instance and the invariants tested. All passed:
> ABN mod-89 generated column (real ATO ABN `51824753556` ⇒ true, one digit corrupted ⇒ false) ·
> unbalanced posted transaction **rejected at COMMIT** · unbalanced *draft* accepted and editable ·
> that draft **refused promotion to posted** while unbalanced · `gst_amount` without a `tax_code`
> rejected by check constraint · every posted transaction sums to exactly `0.0000` ·
> `is_tax_invoice = false` correctly flips its GST to `gst_unclaimable`.

**Worked example** — $110 fuel including $10 GST on a credit card:

| Split | Account | Amount | Tax code |
|---|---|---|---|
| 1 | Motor Vehicle — Fuel (expense) | `+100.0000` | `GST` |
| 2 | GST Receivable (asset) | `+10.0000` | — |
| 3 | Credit Card (liability) | `-110.0000` | — |
| | | **`0.0000`** ✓ | |

### Tax codes, not ad-hoc GST fields

A seeded `tax_codes` table mirroring Xero/MYOB conventions, each declaring its BAS label mapping:

| Code | Meaning | Rate | Purchase labels | Sale labels |
|---|---|---|---|---|
| `GST` | GST on non-capital purchases | 10% | G11, 1B | — |
| `CAP` | GST on capital purchases | 10% | G10, 1B | — |
| `GSTONINCOME` | GST on sales | 10% | — | G1, 1A |
| `FRE` | GST-free | 0% | G11 | G1 |
| `INP` | Input-taxed | 0% | G11 | G1 |
| `EXP` | Export sale | 0% | — | G1 |
| `N-T` | Not reportable | 0% | — | — |

This one table makes BAS reporting a `GROUP BY`, and makes Xero/MYOB export a lookup instead of a
translation layer. It is also the industry-standard shape, so accountants recognise it immediately.

### Where scans meet the ledger

An `auto_accepted` document proposes a **draft** transaction with splits pre-filled from the
document lines and tax subtotals. The user confirms once; it posts. `transactions.document_id`
keeps the image attached as evidence for the life of the record.

### 5.1 Human review: edit, confirm, save

The reviewer is part of the data model, not a UI afterthought. Three guarantees, all enforced in
Postgres rather than trusted to application code:

1. **What the model said is never lost.** `extraction_runs.raw_response` keeps the exact model output;
   `document_field_corrections` records every human edit as
   `(field_path, old_value, new_value, corrected_by, corrected_at)`.
2. **A human edit outranks any later machine run.** This was a real gap. Re-extraction flips
   `documents.current_run_id` and would otherwise silently overwrite a field a person had already
   fixed — destroying exactly the data that cost a human their attention.
   `documents.locked_fields` holds the field paths a human confirmed or edited, and a trigger
   **rejects any machine attempt to release a lock**. A better model may *disagree* with a locked
   field — that raises a `review_task`, it does not overwrite.
3. **Confirmation is the draft → posted transition.** Editing a document changes data; confirming it
   posts a balanced transaction to the ledger. Two separate acts, separately audited, and only the
   second one moves the books.

> **Verified.** A machine run attempting to release `header.payable_amount` is rejected; the same
> release accompanied by a human review succeeds; a machine may still *add* locks for new
> low-confidence fields.

---

## 6. Australian tax export

### BAS

Most users are on **Simpler BAS** (GST turnover under $10 M): only **G1, 1A, 1B** are reported.
The full seven-label method (G1, G2, G3, G10, G11, 1A, 1B) is mandatory at $10 M+ turnover or for
input-taxed businesses. Support both; default to Simpler BAS.

The BAS report is a `GROUP BY` over `transaction_splits` joined to `tax_codes`, filtered by period
and the tenant's cash/accrual basis setting. Sanity checks shipped as part of the report:
`1A ≈ G1 / 11` and `1B ≈ (G10 + G11) / 11`.

### The correctness link that justifies the whole architecture

**You may only claim a GST input credit if you hold a valid tax invoice** (required at $82.50 incl GST
and above; the buyer's ABN must also appear at $1,000 and above).

`is_tax_invoice` comes out of the extraction validators. So **label 1B only includes splits whose
evidence document has `is_tax_invoice = true`.** Everything else accrues to a visible
"unclaimable GST" figure.

That gives the product its sharpest feature almost for free:

> *"You have $342.18 of GST credits you cannot claim. 12 receipts are missing a supplier ABN.
> Tap to request valid tax invoices."*

No competitor doing naive OCR-to-CSV can say that, because they never modelled invoice validity.

### Export surface

| Target | Form | Notes |
|---|---|---|
| **Xero** | `BankTransaction` (spend money) or `Invoice` type `ACCPAY`, + original image via `POST /api.xro/2.0/{Endpoint}/{Guid}/Attachments/{Filename}` | Hard limits: **60 calls/min, 5,000/day, 5 concurrent per second, per tenant token.** Needs a per-tenant token bucket and an outbound queue — not fire-and-forget. |
| **MYOB / QuickBooks** | Same mapping via `tax_codes` | Phase 7 |
| **myDeductions** | Spreadsheet in ATO myDeductions shape | Emailable to a tax agent, or uploadable for myTax prefill (available from 1 July 2026 for the 2025–26 return) |
| **BAS worksheet** | G1/1A/1B, or full 7 labels | PDF + CSV |
| **Tax pack** | ZIP: CSV + PDF summary + **all original images**, foldered by quarter and category | This is the deliverable an accountant actually wants |
| **Local backup** | SQLite file + images ZIP to device storage / Files app | Satisfies "saved to local" as a user-controlled export, on top of the synced replica |
| **Peppol PINT A-NZ** | UBL invoice XML | Phase 7; the schema is already shaped for it |

### 6.1 Reusing the `free-tax-returns` engine — and the product moat

> **✅ Done — `packages/tax-engine`.** Extracted 2026-09-09, **byte-identical** to the source
> (verified with `diff -r`). **217 tests pass** (186 engine + 31 new package-boundary checks);
> `tsc --noEmit` clean with no `dom` lib. The engine was already self-contained — its only
> non-relative import was `vitest`, and the source project enforces that with an eslint boundary
> rule — so extraction added packaging only and changed no engine code.
>
> Two corrections to earlier claims in this plan: the suite is **217 tests, not 165** (it grew since
> the doc that quoted that figure), and the source project's own copy at `src/engine/` was **left in
> place** rather than refactored, because it is near launch. There are two copies until that
> project has room to consume the package; `packages/tax-engine/README.md` carries the four-step
> de-duplication procedure and the drift check.

`free-tax-returns/free-tax-return-preview` contains a validated Australian deduction engine:
FY-versioned rates (`rates/fy2026.ts`, TD 2025/4), 19 occupation profiles with benchmark ranges,
and per-label calc modules. It is now a shared package consumed by both products — one rate set, one
annual update, one test suite.

**A constraint that lands on D5/D6.** The engine uses extensionless relative imports
(`from './calc/cheatsheet'`). Bundlers resolve these; **raw Node ESM does not** — verified,
`node --experimental-strip-types` fails with `ERR_MODULE_NOT_FOUND`. Next.js (with
`transpilePackages`), vitest, `tsx`, `tsup`, esbuild and Bun are all fine. So **the extraction
worker must run under `tsx` or be bundled with `tsup`** — not plain `node`. Worth knowing before
scaffolding it. Adding `.ts` extensions across all 49 files would fix raw-Node use but diverge from
the source project and complicate future syncing, for no product benefit.

**Behaviour the schema must respect** (pinned by the new boundary tests): an empty worksheet is
**not zero** — every profile claims the **$10 receiptless bucket-donation floor** at D9, with the
`tither` flow the documented exception. Cents-per-km is capped at 5,000 work km (a $4,400 ceiling);
decline in value is valuation-capped at $69,674 ÷ 8 = **$8,709.25/yr**.

**The moat this creates.** The engine knows which deduction labels each occupation can claim. So Snap
Apps does not merely categorise a receipt as "fuel" — it categorises it into **the exact worksheet row
the engine expects**, for that user's occupation profile. A servo receipt for a `truckie_long` lands in
the D1 logbook running-costs block; a laundromat docket lands in D3 alongside the $3.00/week home
laundry allowance; a motel invoice lands in D2 under the TD 2025/4 daily cap of $165.00.

That gives the two products one continuous story:

> Scan receipts all year in Snap Apps → on 1 July, the deduction worksheet is already filled in.

No competitor doing generic OCR-to-CSV can do this, because they have no occupation engine to target.
It also explains why a free tier is worth paying for: it is the year-round capture funnel into the
tax product.

**Schema consequences** (already reflected in `data-model.sql`): `categories.ato_deduction_code`
carries the engine's D-label and row identifier rather than a free-text label, and the tenant/user
record stores the chosen `occupation_profile_id` so categorisation can be profile-aware.

**One correction to the earlier caveat.** The first draft of this plan advised getting the AU tax
logic reviewed by a registered tax agent. That is closer to done than I assumed — the formulas are
consultant-sourced (via `reference/FORMULAS.md`) and pinned by 165 tests. But it is **not** finished,
by the project's own records:

- `tech-debt.md` lists **"Tax-agent sign-off on `fy2026.ts` + the 365/366 proration ruling + the
  FORMULAS-vs-data.js benchmark drift"** as an *unchecked launch gate*.
- The benchmark-drift ruling is still open — FORMULAS.md says `whitecollar 21,000|16,000` while
  `data.js` says `24,000|15,500`, and the engine currently asserts the `data.js` values pending a
  decision.
- `decisions.md` records that the client spreadsheet is **absent from the project folder**, so
  full-worksheet cross-validation against the original is still outstanding.

Snap Apps **inherits that open gate**. It does not need to re-do the work, but it must not ship tax
output as authoritative until the gate closes.

---

## 7. Security & Australian compliance

### Tenant isolation

RLS on every tenant-scoped table, `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
The API sets `SET LOCAL app.tenant_id` per transaction. Distinct DB roles: `app_rw` (RLS enforced,
used by every request), `app_migrate`, `app_readonly`. **No request path ever uses a
`BYPASSRLS`/superuser role.** RLS bypass is an explicit, tested, audited code path or it does not exist.

PowerSync sync rules must be derived from the same `tenant_id` predicate — a sync rule is a second
authorisation surface, and it is the one most likely to leak. Test it like an endpoint.

### Things that bite receipt/finance apps specifically

- **Card numbers.** Receipts print masked PANs. Regex-scrub at ingest; store only `card_last4` and
  `card_brand`. Keeping a full PAN drags you into PCI-DSS scope for zero product value.
- **EXIF GPS.** Stripped from the *derived* copy and never indexed. Location is unnecessary here.
  Opt-in only, separately consented.
- **Bank details** (BSB/account on invoices) — app-level AEAD with a KMS-wrapped DEK, ciphertext in
  `BYTEA`. Not `pgcrypto`: keys passed in SQL text end up in logs and `pg_stat_statements`.
- **The local replica is now a breach surface.** SQLite on-device must use SQLCipher or platform
  keystore-backed encryption, and the app must wipe it on logout and on remote revocation.
- **Xero tokens** are long-lived money-adjacent credentials. Encrypted at rest, per-tenant, rotated,
  and revocable from the UI.

### Regulatory obligations

| Obligation | Source | Implementation |
|---|---|---|
| Records kept **5 years** | ATO | `documents.retention_until = issue_date + 5y`; purge job; originals are not deletable before it |
| Electronic copies must be a **true and clear reproduction** | ATO record-keeping rules | Original bytes retained unmodified; legibility check at ingest; normalisation only ever produces a *derivative* |
| Active destruction when no longer needed | Privacy Act APP 11 (strengthened in the 2026 reform exposure draft) | Retention is a *column with a job*, not a policy PDF |
| Breach notification within **72 hours** (proposed) | NDB scheme reform | Append-only `audit_log` with actor + request ID is what makes scoping a breach possible at all |
| Cross-border disclosure | APP 8 | **Bedrock `ap-southeast-2`** keeps inference in Sydney. On the first-party API instead, pin `inference_geo` and disclose the transfer. |
| Tax invoice validity | ATO: 7 required elements; buyer ABN at ≥ $1,000 incl GST; tax invoice required at ≥ $82.50 incl GST | `ato_compliance JSONB` records which elements were found; drives `is_tax_invoice`; gates label 1B |

Anthropic does not train on API data; request ZDR if the privacy policy needs to say so plainly.

### API surface hardening

Per-tenant API keys (hashed at rest, prefix-searchable), scopes, `Idempotency-Key` required on
`POST /v1/captures` and on every ledger write, HMAC-signed webhooks with replay windows, per-tenant
rate limits.

---

## 8. Roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0. Contracts** | ✅ pnpm workspace · ✅ `packages/tax-engine` (217 tests) · ✅ `packages/db` — 10 migrations, Drizzle declarations, drift + RLS suites (68 tests) · ✅ `packages/api-contract` · ✅ boundary enforcement (8 tests) · ✅ `extraction-schema.json` v1 · remaining: OpenAPI spec | Schema reviewed; API contract frozen enough to build both sides against |
| **1. Capture** | Presigned upload, idempotency, sha256 + phash dedup, original-preserving normalisation | Same receipt twice ⇒ one capture, `409` on the second; original bytes byte-identical to the device file |
| **2. Extraction** | Worker, Claude tier 1+2, strict schema, **all validators**, replay command | Golden set of 50 real AU receipts (Coles, servo, café, tradie invoice, handwritten) at ≥ 95% field accuracy |
| **3. Ledger** | Accounts, transactions, splits, sum-zero trigger, draft-from-document | Deliberately unbalanced posting is **rejected by the database**, not by app code |
| **4. Tax & reports** | BAS (Simpler + full), unclaimable-GST report, tax pack ZIP | BAS output reconciles: `1A ≈ G1/11`, `1B ≈ (G10+G11)/11`, and 1B excludes non-tax-invoices |
| **5a. Mobile demo** | ✅ Expo SDK 57 app: Home / Scan / Menu, Receipts, Review, Invoices, Tax, contract-backed mock, engine-generated fixtures | Runs with no server; drives capture → review → confirm; both themes verified |
| **1. Capture API** | ✅ NestJS on Fastify, ✅ session tokens (HMAC, no passwords), ✅ `POST /v1/captures` with content-hash dedup, ✅ `PUT /v1/uploads/:token` (server recomputes the hash), ✅ queued extraction, ✅ documents read/correct/confirm/reject/lines, ✅ OpenAPI generated from the DTOs at `/v1/openapi.json`, ✅ migration 0013 (`parties.kind` + dedupe index), ✅ queue lock expiry, completion and backoff | 27 end-to-end checks against real Postgres: a non-member gets 403 from the database, the same bytes twice is one capture, a stale correction gets 409, Staff cannot post to the ledger |
| **2b. Model strategy** | ✅ `docs/AI.md` decision record: vision + chat models chosen on measured scores, ✅ `src/ai/router.ts` capability-based routing with escalation, ✅ `src/ai/tools.ts` (58 tests) so the assistant never states a figure from model knowledge, ✅ committed benchmark harnesses in `apps/server/bench/` | Tool calling lifts glm-5.3 from 3/5 to 4/4 on Australian tax rules; every candidate called the right tool 4/4. DeepSeek excluded from chat for calling a tool and then ignoring its answer |
| **2a. Extraction, proven** | ✅ Prompt + provider seam (Ollama Cloud dev tier, Bedrock stub that refuses rather than falling back offshore), ✅ deterministic validators (38 tests): ABN mod-89, GST = 1/11, lines-vs-total, date window, day/month ambiguity gated on whether it changes the BAS quarter, ✅ `runExtraction` → `toDocument`, ✅ `pnpm --filter @snap/server extract <image>` | End to end on a photographed, creased, glare-covered docket: all fields correct, auto-accepted, 4.1s, 1129/438 tokens. The same model returned three different dates for an ambiguous `06/09/26` across runs, so the date is never trusted — it is checked |
| **5e. Identity** | ✅ Sign-in (no password, ever), ✅ three-step onboarding, ✅ session persisted, ✅ five demo accounts spanning four roles, ✅ GPS trip recording (12 geo tests), ✅ estimate → invoice conversion | Signing in as Staff removes the ability to post to the ledger and says why; a household member cannot see the business at all — both verified by driving the app, which is how two real isolation bugs were found |
| **5d. Mobile complete** | ✅ Local persistence (delta-based, applied by naming convention + tested), ✅ search + period filters + CSV export over ~950 documents, ✅ full field correction with a date-window guard, ✅ reject a mis-scan, ✅ invitation accept screen + deep link, ✅ invoice PDF via the share sheet, ✅ multi-page capture, ✅ duplicate-capture handling, ✅ part payment of a bill, ✅ reset demo data | A change survives a reload (verified by reloading, not by looking); no empty `onPress` handlers anywhere; a 2006 date is refused. Deferred with reason: push notifications and the offline outbox, both of which need the server |
| **5c. Collaboration + feature complete** | ✅ Workspace = tenant (migration 0012: `tenants.kind`, invitations, `created_by`/`confirmed_by`, document `version`), ✅ membership-verified switching (`withTenantAs`), ✅ people and roles, ✅ line items on every document with an image/facsimile panel, ✅ bills, payments, mileage, stock take, tax pack, connections, settings, categories, plan, recurring, goals | No menu entry says "Soon"; a non-member cannot switch into a workspace (18 membership tests on real Postgres); document lines sum EXACTLY to the payable amount across all 919 fixture documents |
| **5b. Two workspaces** | ✅ Business and personal spending behind one switch, ✅ budgets with per-category caps, ✅ analytics page (bar series, category ring, merchants) over month/quarter/year | Personal UI mentions no GST, ABN or tax invoice anywhere; every figure comes from `getAnalytics`/`getPersonal` behind the seam, not from screen-side aggregation (37 mobile tests) |
| **1b. Server complete** | ✅ Migration 0015 the identity plane (sign-in, your own row, workspace creation, invitation acceptance as SECURITY DEFINER functions owned by a NOLOGIN `app_identity`, not by a superuser), ✅ separate `snap_app` / `snap_worker` login roles, ✅ 0016 email shape, ✅ 0017 categories retired not deleted, ✅ 61 routes: overview, personal, analytics, recurring, sales, mileage, settings, occupations, categories, plan, connections, tax pack, onboarding, visibility, ✅ seam response types moved into `@snap/api-contract` so server and app cannot drift without failing to compile, ✅ aggregation shared rather than reimplemented in SQL | **RLS was never actually enforced** — the server connected as `postgres`, which has `rolbypassrls`, so no policy anywhere had ever been evaluated. `/v1/ready` now reports the role and whether it bypasses. 15 identity tests assert the NEGATIVE case (that `app_rw` genuinely cannot read `users` or insert a tenant), because a suite that only checks the happy path is what let this survive. 105 e2e checks across three suites, all as the non-superuser role |
| **1c. App on the server** | ✅ `HttpApi` implementing all 59 seam methods over fetch, ✅ ambient auth token + active workspace (`api/context.ts`), chosen by `EXPO_PUBLIC_API_URL` so the same binary runs on fixtures or on a server, ✅ CORS allow-list (never `*`), ✅ invitation acceptance and tax-pack assembly wired to real endpoints instead of `setTimeout`, ✅ store-method ZIP writer (9 tests, round-tripped through a real extractor), ✅ signed short-lived download links, ✅ seeded invoices/payments/trips so sales and mileage are exercised rather than answering zero | 21 screens driven headless against Postgres: **79 API calls, 0 failing, no console errors**. Four bugs only running it could find: `AuthUser.initials` declared twice and absent from every server response (crashed every screen on `charCodeAt`); screens fetching before the workspace was known (403s that recovered a second later); `memberships_self` being PERMISSIVE, so an owner of two workspaces appeared twice in one member list and inflated the seat count; `deductions.caps` returned empty, crashing the tax screen on a BigInt |
| **1d. Offline writes** | ✅ Idempotency across every workspace-scoped write (`Idempotency-Key`, the `idempotency_keys` table that had sat unused since 0008) — claim-then-record, so two concurrent retries cannot both proceed; ✅ a durable outbox in the app (`api/outbox.ts`, 10 tests) persisted to storage, replayed oldest-first with the key it was queued with, scoped to the workspace it was made in; ✅ builds: `expo-doctor` 21/21, production bundle proven against the real server, `eas.json` with four profiles, `docs/BUILD.md` | A write made with the browser genuinely offline: queued durably, **nothing** reached the server, then on reconnect it drained by itself and landed **once** — Groceries 900 → 910. Two defects found only by running it: CORS did not allow the `Idempotency-Key` header, so the browser blocked the drain at preflight and the queue could never send; and `enqueue` appended to state it had never loaded, which would have dropped an existing queue on the first offline write of a session. **Known gap:** no screen tells the user a write is queued — the mechanism works silently |
| **5. Sync + mobile** | PowerSync rules, encrypted local SQLite, Expo app: capture, quality gate, outbox, review, ledger, reports | Airplane mode: browse full history, add a transaction, capture a receipt; all reconcile on reconnect |
| **6. Xero** | OAuth 2.0 + PKCE, rate-limited outbound queue, transaction + attachment push, reconnect/revoke | 500 transactions push without a single 429; every one carries its image attachment |
| **6.5 Billing** | Plans, subscriptions, quota metering, Stripe web checkout, IAP where forced | A free tenant at quota is offered a top-up and **never loses the capture**; cost-vs-price guardrail alerts |
| **7. Hardening + ecosystem** | RLS + sync-rule test suite, retention/purge jobs, OTel traces, load test; MYOB/QuickBooks, Peppol PINT A-NZ export | Automated test proves tenant A cannot read tenant B by **any** route, including a PowerSync rule |

**The golden set in Phase 2 is the single highest-leverage artefact in this plan.** Fifty real
Australian receipts with hand-verified ground truth, committed to the repo. Without it, every later
prompt or model change is a guess. Build it before tuning anything.

---

## 9. Open decisions

| # | Question | Default if you do not decide |
|---|---|---|
| O1 | Bedrock Sydney, or first-party Anthropic API? | Bedrock `ap-southeast-2` — data residency is cheaper to have than to retrofit |
| O2 | Auth: build it, or Keycloak / WorkOS / Supabase Auth? | External IdP; store `subject` only. Do not own password hashing. |
| O3 | Hosting: Fly.io / Railway / AWS ECS / a single Hetzner box? | Fly.io `syd` for v1 — cheap, AU region, trivial to leave |
| O4 | PowerSync (hosted or self-hosted) vs WatermelonDB? | PowerSync self-hosted — saves weeks; the protocol is not where you want to spend them |
| O5 | Bank feeds (Basiq / CDR-accredited aggregator)? | **Out of scope for v1.** CDR accreditation is a months-long compliance project, not a feature. |
| O6 | Individuals (myDeductions, D1–D10 labels) or businesses (BAS, ABN) first? | Businesses first — BAS is the harder model, and individuals fall out of it as a subset |
| O7 | Multi-tenant from day 1, or single-tenant then retrofit? | **Day 1.** `tenant_id` + RLS is cheap now and near-impossible to add later. |
| O8 | Cash or accrual GST basis? | Support both as a tenant setting from Phase 4 — it changes which date the BAS period filters on |
