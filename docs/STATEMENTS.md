# Statements, reconciliation, and what "smarter" actually means

**Date:** 2026-09-17 · **Status:** research, plus four scope decisions taken by
the owner on 2026-09-17 and recorded in §14.1. §5.3.1 holds the R5 design of
2026-09-18 — **proposed**, not decided; its open questions are §14.2 items 4
and 5. The queue in §12 is **proposed**; nothing in it is scheduled.
**Answers:** what it would take to read bank and credit-card statements, categorise
them, show money in as well as money out, and never post one expense twice.
**Does not answer:** how long any of it takes, or what ships first. §14.2 holds
the questions still open, and they are not settled here.

Every claim about the current system below was checked in the repository at
`6f0b76b`, not recalled. Where a file is named, it was read.

---

## 0. The shape of the request, and the one sentence that reframes it

The ask has four parts: **read statements**, **categorise them well**, **avoid
double entry against receipts**, and **show money in, debit and credit**. Plus a
fifth that is not a feature: *make the whole app top of class*.

The reframing that makes the first four tractable:

> **A receipt and a statement line are not two records. They are two
> observations of one economic event, and each knows something the other does
> not.**

The receipt knows *what was bought* — line items, the GST/PPN split per
category, whether the paper is a valid tax invoice. The statement knows *what
actually happened* — that the money left the account, on what date it cleared,
against which card, and what the balance was afterwards.

Neither is the truth. Deduplication that picks a winner throws away half the
record. The design below **merges** them into one transaction where each side
supplies the fields it is authoritative for, and that turns out to map onto the
existing schema almost exactly (§5.3).

The fifth part is addressed in §11, honestly: most of "top of class" is already
specified in `docs/GAPS.md` and blocked on one thing that is not code.

---

## 1. What already exists — do not rebuild any of it

Verified in the repository. This section exists so the plan below adds a layer
rather than a parallel system.

| Capability | Where | State |
|---|---|---|
| Multi-page capture, per-page upload, byte-level dedup | `apps/server/src/captures/captures.controller.ts` | **Built.** Whole-document SHA-256 **and** per-page, so re-photographing page 2 does not re-upload page 1 |
| **PDF intake with text-layer detection** | `apps/server/src/extraction/pdf.ts` + `pdf.test.ts` | **Built.** Classifies each page `pdf_native` (real text layer) or `pdf_render`, by inspection, not by what the uploader called the file |
| Versioned, replayable extraction runs | `apps/server/src/extraction/run.ts` | **Built.** Same bytes + same prompt + same model ⇒ same document |
| Double-entry ledger, balance enforced by Postgres | `packages/db/migrations/0006_ledger.sql` | **Built.** Deferred constraint trigger; splits of a posted transaction sum to zero |
| Chart of accounts with `income` type | `accounts.account_type` | **Built** — and unused on the money-in side (§3.2) |
| Per-category tax subtotals (Peppol BG-23) | `document_tax_subtotals`, `extraction/tax-subtotals.ts` | **Built.** The flagship capability |
| Pluggable per-country tax rules | `packages/tax-rules/` | **Built.** Rules are data, one set installed at a time; `id-2026` ships |
| Trigram extension for fuzzy name matching | `pg_trgm`, enabled in `0001` | **Enabled, unused.** Named in the schema comment as *"fuzzy supplier-name matching"* |

**PDF intake being already built is the single most load-bearing fact in this
document.** Bank and credit-card statements are overwhelmingly delivered as PDFs
with a real text layer. `pdf.ts` already routes those to `pdf_native`. A
statement therefore enters this system on a path that needs **no OCR at all**,
which is a different cost, latency and accuracy regime from a photographed
thermal docket — see §9.

---

## 2. The schema already anticipated this, and then nothing happened

Four columns exist, are indexed where appropriate, carry comments describing
exactly the feature being asked for, and are **written by nothing and read by
nothing**. Checked by grep across `apps/` and `packages/`:

| Column | Comment in the schema | Application code that touches it |
|---|---|---|
| `captures.phash` | *"perceptual hash for near-duplicate detection"* | **none** — declared in `packages/db/src/schema/tables.ts:184` and nowhere else |
| `documents.dedup_group_id` | *"business-key fingerprint group; flag, never auto-merge"* | **none** — `tables.ts:355`, plus its own index |
| `documents.card_last4` / `card_brand` | *"masked PAN only"* | **none** — `tables.ts:350`; the type in `extraction/types.ts` has no payment fields at all |
| `transactions.settled_date` | *"cash-basis GST filters on this"* | **none** — `tables.ts:484` |

And two enum members already exist for work never done:

- `doc_type` includes **`'statement'`** — the prompt offers it, `provider.ts:148`
  accepts it, and no code branches on it. A statement classified today lands in
  the receipt pipeline and is extracted as if its closing balance were a total.
- `txn_source` includes **`'bank_feed'`** and **`'import'`** — neither is ever set.

There is a third, sharper instance of the same pattern. `docs/extraction-schema.json`
is titled *"Strict output contract"* and marks `payment` (with `card_last4` and
`card_brand`), `rounding_amount`, `due_date`, `tax_subtotals` and a `bbox` on
every field as **required**. `apps/server/src/extraction/types.ts` — the type the
code actually validates against — has none of them.

> This is the README's own failure shape, a fourth time: *nothing checks the
> agreement between two correct things.* A documented schema and an implemented
> schema, each internally consistent, disagreeing in production with no test
> between them. **S0 in §12 makes that a red test before any statement work
> starts**, because the statement schema is about to be the second contract in
> this file and it must not repeat this.

The practical consequence for planning: **the dedup, the card match and the
settled-date merge are not new schema. They are four columns waiting for a
writer.** That materially lowers the cost of §5.

---

## 3. What is genuinely missing

Five things, in descending order of how much they block.

### 3.1 There is no account, and no statement

There is no table representing *an account that holds a balance over time*. A
receipt is a point event. A statement is a **period** — an opening balance, a
sequence of movements, a closing balance, belonging to an account that persists
across statements. `documents` cannot express that: it has `issue_date` and a
set of amount columns shaped like an invoice, and `documents_capture_unique`
makes one document per capture, which is right for a 12-page statement PDF and
says nothing about its 300 rows.

Forcing statement rows into `document_lines` would be wrong in a way that costs
later: a `document_line` has `quantity`, `unit_price`, `gst_category_code`,
`gst_rate` — the vocabulary of *goods*. A statement row has date, description,
debit, credit, running balance. Different nouns.

### 3.2 There is no money in

`PersonalSummary` (`packages/api-contract/src/index.ts:554`) is spend-only:
`spentThisMonth`, `budgetTotal`, `remaining`, `safeToSpendPerDay`, `byCategory`,
`topMerchants`. `AnalyticsSummary` is the same. There is no income series, no
net position, no savings rate. The business side has money in through invoices
and `transactions.sale.test.ts`, but nothing observes actual receipts of cash.

This is the part of the ask that is pure gain: a statement carries both columns,
so money in arrives as a **consequence** of reading statements rather than as
separate work.

### 3.3 There is no semantic dedup

Deduplication today is **byte identity**: `captures_sha_unique (tenant_id,
original_sha256)`, plus per-page hashes. It catches "the same photo uploaded
twice" perfectly and catches nothing else. A receipt photo and a statement PDF
for the same $84.20 fuel stop share not one byte.

### 3.4 There is no reconciliation state

`transactions` has `status` (`draft`/`posted`/`void`) and `document_id` as
evidence. There is no notion of *cleared*, no link between a transaction and the
statement row that cleared it, and therefore no answer to "which of my posted
expenses has the bank actually seen?" — which is the question an accountant opens
the app to ask.

### 3.5 Nothing learns

`document_field_corrections` carries the comment *"Every correction is training
signal. Mine this table before touching the prompt."* Nothing mines it. There is
no per-tenant memory that "BP CONNECT" is fuel, even after the user has said so
eleven times. Categorisation accuracy is therefore flat over the life of an
account, which is the opposite of "smarter along the way".

---

## 4. The claim this plan rests on: a statement grades its own extraction

This is the most important paragraph in the document.

A receipt cannot tell you whether you read it correctly. You need ground truth —
which is exactly why `docs/GAPS.md` **B1** (≥ 40 real Australian documents with
per-field truth) blocks every accuracy claim in the product, and why
`docs/ROADMAP.md` §5 calls it *"the one ticket that cannot be delegated,
synthesised, or coded."*

**A statement is not like that.** It carries its own checksum in print:

```
opening_balance + Σ credits − Σ debits = closing_balance
```

If that identity fails, the read is wrong, and you know it **without any ground
truth, without a gold set, and without a human**. A missed row, a transposed
digit, a truncated page, a debit read as a credit — every one of them breaks the
equation. And the failure is *localisable*: the running-balance column on most
statements means the per-row delta can be checked against the printed balance,
so the reader can say **which row** it got wrong, not merely that something is.

Three consequences, and they are large:

1. **Statement extraction can be measured on day one.** It does not queue behind
   B1. This is the only substantial accuracy work in the repository that is not
   blocked on Hansel photographing dockets.
2. **`auto_accepted` becomes defensible here before it is anywhere else.** A
   balanced statement with every row's delta agreeing with the printed running
   balance is verified arithmetic, not a confidence score. `docs/GAPS.md` **B3**
   (calibration, gate G3) does not gate this, because this is not a probability.
3. **It is a genuine self-test for the reading engine.** A statement that
   balances on 300 rows is 300 correct reads of money, dates and signs, on real
   paper, attributable. That is evidence about the engine that the synthetic
   Tier S corpus cannot produce — see §9.4.

The deterministic-validator discipline already in `extraction/validators.ts`
(nine GST checks) is the same idea. The statement version is stronger, because
where the GST checks test *plausibility*, the balance check tests *completeness*.

**Caveat, stated so it is not oversold:** the identity proves the rows are
internally consistent. It does not prove the descriptions were read correctly,
nor that the categories are right. It is a check on the numbers, which is where
the money is, and not on the words.

---

## 5. The proposed design

Everything in this section is a **proposal**. §14 lists what must be answered
before any of it is right.

### 5.1 New nouns

Three tables, plus a link table. Names are provisional.

**`financial_accounts`** — a bank account, credit card or e-wallet the tenant
owns. Tenant-scoped, RLS like everything else. Holds an institution, a **masked**
number only (the `card_last4` rule extended: never store a full account number —
it is the same PCI/PII argument the schema already makes for PANs), a currency, a
type (`transaction` / `savings` / `credit_card` / `ewallet`), and a link to the
`accounts` row in the chart of accounts that it *is*. That link is what makes the
double-entry side work without inventing a second ledger.

**`statements`** — one row per statement document. `document_id` (the statement
PDF is still a document and still carries the immutable original — principle 1 is
untouched), `financial_account_id`, `period_start`, `period_end`,
`opening_balance`, `closing_balance`, and a `balance_check` verdict with the
computed residual. A statement whose residual is non-zero is **not rejected** —
it is stored with the residual recorded and routed to review, because a statement
we cannot fully read is still evidence and deleting it loses the record.

**`statement_lines`** — the rows. `statement_id`, `line_number`, `posted_date`,
`value_date` (they differ, and the difference is exactly what makes matching
hard), `description_raw` (as printed, never normalised — the original is the
record), `description_normalised` (derived, indexed with `pg_trgm`),
`amount_signed` (one signed column, debit positive, **matching the ledger's own
convention** rather than inventing a second one), `running_balance`,
`counterparty_hint`, `card_last4`, and a `foreign` block for FX rows.

**`event_observations`** — the link table that does the actual work. See §5.3.

### 5.2 A second extraction schema, not a widened first one

`docs/extraction-schema.json` is v1 and receipt-shaped. The proposal is a
sibling, `statement-schema.json` v1, selected by classification, **not** a set of
optional fields bolted onto the existing one. Reasons:

- The nouns genuinely differ (§3.1). A shared schema with half its fields null
  on every document is how a strict contract stops being strict.
- `run.ts` already versions and stores `schema_version` per run, so two schemas
  cost nothing structurally.
- **Output truncation is a real and specific hazard here.** `run.ts` already
  distinguishes `truncated` from `parse` failures and comments on exactly why:
  a cut-off response is unparseable, and escalating to a stronger model hits the
  same cap because *"the cap is ours."* A 12-page statement with 300 rows will
  hit it. The statement path must therefore extract **per page**, with the
  running balance stitching pages together — and the balance check is what
  proves the stitch worked. This is a design constraint, not a nice-to-have.

### 5.3 Deduplication: observations of an event, never a winner

The core proposal. **Never merge records, never auto-delete, never pick a
winner** — the existing `dedup_group_id` comment already says *"flag, never
auto-merge"* and this honours it.

A `transaction` is the economic event. Each piece of evidence for it is an
**observation**:

```
event_observations
  transaction_id     -> the one economic event
  source_kind        'receipt' | 'statement_line' | 'manual' | 'invoice'
  document_id        the receipt        (nullable)
  statement_line_id  the statement row  (nullable)
  match_confidence   numeric
  match_reasons      text[]   -- 'amount_exact','card_last4','date_window','merchant_trgm'
  confirmed_by       user id, null until a human agreed
  confirmed_at
```

Then the merge rule, which is where the two sides stop competing:

| Field | Authority | Why |
|---|---|---|
| `txn_date` | the **receipt** | when the purchase happened |
| `settled_date` | the **statement line** | when the money moved — and this is the column *"cash-basis GST filters on"*, currently written by nothing |
| splits, categories, GST/PPN per category | the **receipt** | only it has line items |
| amount | **statement line** if they disagree | the bank cleared a number; the paper can be a quote, a tip-adjusted total, or a pre-auth |
| `source` | `scan` when a receipt is present, else `import` | the enum already has both |
| evidence | **both**, retained forever | principle 1 |

**The disagreement is the feature.** Receipt $84.20, statement $89.20 on a
restaurant bill is a $5 tip, and the app should say so rather than silently
preferring one. A receipt with no statement line after the statement covering its
date has been read is a **missing-from-bank flag** — possibly cash, possibly a
receipt for something never paid. A statement line with no receipt after 60 days
is a **missing-substantiation flag**, which on the business side is a GST or PPN
credit at risk, and that is worth money.

None of those three states is expressible today.

### 5.3.1 R5 — the observation register and the merge rule

**Status: proposed**, by the architecture pass of 2026-09-18, against the tree
of that date. It elaborates §5.3 into something `senior-db` and `senior-be` can
build without re-deriving it. It decides nothing on the owner's behalf: the two
questions it cannot settle are §14.2 items 4 and 5. Every claim about existing
code below was read, not recalled — `0031_statements.sql`,
`0030_goal_contributions.sql`, `0006_ledger.sql`, `0007_ops.sql`,
`0023_admin_audit_and_gaps.sql`, `apps/server/src/transactions/transactions.repo.ts`,
`apps/server/src/statements/*.ts`, `apps/server/src/worker.ts`, and
`packages/db/test/{rls,drift}.test.ts`.

#### The seam that already exists

One economic event reaches the ledger by exactly one road today:
`draftTransactionFromDocument` → `postTransaction`
(`apps/server/src/transactions/transactions.repo.ts`). Read closely, that road
is **already a merge of one observation**: splits from `document_tax_subtotals`
or the lines, `txn_date` from `issue_date` (falling back to `current_date`), a
payment leg to a brand-derived liability (`2-11VI Credit Card — visa`) or to
Trade Creditors when no card was read, `source = 'scan'`, and
`transactions.document_id` as the evidence pointer. `postTransaction` is, by its
own comment, *"the one and only place `transactions.status` becomes
`'posted'`"*. Nothing anywhere in `apps/server` writes `voided_at` or sets a
transaction `'void'` — voiding exists in the schema and has never happened.
`settled_date` is NULL on every row. R5 adds a second observation to that
road; it does not build a second road.

#### Q1 — `event_observations` is a table, and it holds facts only

**A table**, one row per *(piece of evidence, transaction)*. Not a view: a view
cannot hold the human's confirmation. Not a pattern over
`transactions.document_id` plus a new `statement_line_id` column: a column
holds one, and the cardinalities this lane needs are

| Event | Evidence rows |
|---|---|
| receipt settled by a card line | a `documents` row **and** a `statement_lines` row |
| transfer between two owned accounts (§6, R6) | **two** `statement_lines` rows, no document |
| card payment from a bank account (§6, R6) | two `statement_lines` rows on two `financial_accounts` |
| statement line nobody has paper for | one `statement_lines` row |

One event ← many evidence rows; one evidence row → at most one **live** event.
That is a link table, and it sits beside the ledger without competing with it:
`transactions` + `transaction_splits` say *what happened to which accounts*,
balanced by Postgres; `event_observations` says *how we know*. The existing
`transactions.document_id` stays — `v_bas_lines` reads `is_tax_invoice`
through it and the re-extraction guard in `repo.ts#saveExtraction` reads it —
and becomes a **checked duplication** of the event's document observation,
asserted by a constraint trigger rather than remembered by convention (the
0026 discipline: *"two copies of one fact … is a CHECKED duplication"*).

**Hypotheses do not go in the same table.** §5.3's sketch put
`match_confidence` and `confirmed_by` on one row; that makes every reader
filter on "is this confirmed yet", and the one that forgets double-counts. A
suggested match is not an observation of the event — it is a claim that the
line *might* observe it. So there are two tables:

- **`event_observations`** — facts. A row exists **iff** a human (or the posting
  act itself) has established that this evidence observes this live event.
  No status column. Unlinking deletes the row; the evidence it pointed at is
  never touched.
- **`match_candidates`** — hypotheses and their outcomes. Every suggestion the
  matcher makes, every manual link a user makes, and what became of it:
  `suggested → accepted | rejected`, and `accepted → unlinked`. This is where
  §5.4's *"labels the user generates for free"* accumulate for R7, with the
  raw evidence facts kept beside each label.

`review_tasks` (0007) is **not** reused for candidates, though its own comment
already names `'possible_duplicate'`: it has no outcome column (accepted vs
rejected is exactly the label R7 needs), no FK to `statement_lines`, no
per-pair uniqueness (a rejected pair would be re-suggested forever), and a
300-line statement would swamp a queue built for per-document findings. It
keeps its existing role for document-level flags, including the
`'possible_duplicate'` it was always meant to carry (see *dedup* below).

#### DDL sketch

Two migrations, because `ALTER TYPE … ADD VALUE` cannot be *used* in the
transaction that adds it except from inside a function body compiled later —
`0023_admin_audit_and_gaps.sql:44-52` records the rule and
`packages/db/scripts/db.mjs` wraps each file in one transaction. The
`goal_contributions` CHECK below is a bare use, so it goes in the second file.
Numbers are the next two free at the time of writing.

```sql
-- 0032 — event_observations, match_candidates, and the enum member 0030 left out
CREATE TYPE observation_kind       AS ENUM ('document', 'statement_line');
CREATE TYPE match_candidate_status AS ENUM ('suggested', 'accepted', 'rejected', 'unlinked');
CREATE TYPE match_proposer         AS ENUM ('matcher', 'user');
ALTER TYPE contribution_source ADD VALUE 'statement_line';   -- used only in 0033

CREATE TABLE match_candidates (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  statement_line_id  uuid NOT NULL REFERENCES statement_lines(id) ON DELETE CASCADE,
  -- The other side. In R5 it is always a document: candidates reference
  -- EVIDENCE, never a transaction, because transaction ids change on every
  -- supersede (below) and document ids do not. A line already posted
  -- standalone (R5d) is still matched to the receipt's DOCUMENT; the merge
  -- then supersedes both transactions. R6 makes this nullable and adds a
  -- counterpart_line_id for transfers, with a CHECK that exactly one is set —
  -- a constraint change, not a reshape. A line matched to a hand-typed
  -- transaction is Lane M's (see "does not do", below).
  document_id        uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status             match_candidate_status NOT NULL DEFAULT 'suggested',
  proposed_by        match_proposer NOT NULL,
  matcher_version    text,             -- which generator proposed it; NULL for a user
  -- FACTS, never a score: {"amount_exact":true,"date_gap_days":2,
  --   "card_last4":"equal"|"absent","merchant_similarity":0.83,
  --   "within_posting_lag":true|false|null}. R7 calibrates from these plus
  --   `status`; nothing in R5 reads them to decide anything.
  evidence           jsonb NOT NULL DEFAULT '{}',
  -- A human's account of an amount difference, set only at accept. Never
  -- derived by the matcher. 'tip' | 'surcharge' | 'other'.
  variance_kind      text CHECK (variance_kind IN ('tip', 'surcharge', 'other')),
  variance_amount    money_amount,
  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_candidates_decided         CHECK ((status = 'suggested') = (decided_at IS NULL)),
  CONSTRAINT match_candidates_variance_pair   CHECK ((variance_kind IS NULL) = (variance_amount IS NULL)),
  -- One row per pair, for the life of the pair: a rejected pair is never
  -- re-suggested, and re-linking flips this row rather than adding one.
  -- (R6 re-declares this NULLS NOT DISTINCT over the widened counterpart set.)
  CONSTRAINT match_candidates_pair_unique UNIQUE (statement_line_id, document_id)
);
CREATE INDEX match_candidates_open_line_idx ON match_candidates (tenant_id, statement_line_id) WHERE status = 'suggested';
CREATE INDEX match_candidates_open_doc_idx  ON match_candidates (tenant_id, document_id)       WHERE status = 'suggested';
CREATE INDEX match_candidates_labels_idx    ON match_candidates (tenant_id, status, decided_at); -- R7's held-out pulls

CREATE TABLE event_observations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id     uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind               observation_kind NOT NULL,
  document_id        uuid REFERENCES documents(id),        -- no cascade: evidence outlives links
  statement_line_id  uuid REFERENCES statement_lines(id),  -- no cascade: same
  candidate_id       uuid REFERENCES match_candidates(id) ON DELETE SET NULL, -- NULL for the posting-act row
  confirmed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_observations_pointer_matches_kind CHECK (
       (kind = 'document'       AND document_id IS NOT NULL AND statement_line_id IS NULL)
    OR (kind = 'statement_line' AND statement_line_id IS NOT NULL AND document_id IS NULL)),
  -- One evidence row observes at most one live event. Plain UNIQUE is enough
  -- because only live links live here; NULLs are distinct by default.
  CONSTRAINT event_observations_document_once UNIQUE (document_id),
  CONSTRAINT event_observations_line_once     UNIQUE (statement_line_id)
);
-- R5 scope: one document per event. Two documents for one purchase (an EFTPOS
-- docket AND a tax invoice) is dedup's domain (below) and is NOT joined here.
-- A later lane lifts this index; nothing else has to change.
CREATE UNIQUE INDEX event_observations_one_document_per_event
  ON event_observations (transaction_id) WHERE kind = 'document';
CREATE INDEX event_observations_txn_idx ON event_observations (tenant_id, transaction_id);
```

Two **deferred constraint triggers**, in the 0006 idiom (checked once at
COMMIT, so a write path may void, insert and re-point in any order inside one
transaction):

1. **A link always points at a live event.** For every transaction touched by
   an `event_observations` INSERT/UPDATE or a `transactions` `UPDATE OF status`:
   `status = 'void'` with any observation still attached ⇒ RAISE. This is what
   forces the supersede path (below) to re-point links before it commits, and
   what makes "an orphaned link to a voided entry" impossible rather than
   unlikely.
2. **`transactions.document_id` agrees with the register.** For every non-void
   transaction touched: `document_id IS NOT DISTINCT FROM (SELECT document_id
   FROM event_observations WHERE transaction_id = t.id AND kind = 'document')`
   ⇒ else RAISE. Manual transactions (NULL both sides) pass; the drafts
   `draftTransactionFromDocument` creates pass because R5b makes that path
   insert its observation row in the same transaction.

**Backfill**, on the same footing as 0030's: every non-void transaction with a
`document_id` gets one `kind = 'document'` row (`confirmed_by = posted_by`,
`confirmed_at = coalesce(posted_at, created_at)`), followed by a self-check
that the two counts agree, `RAISE EXCEPTION` otherwise. Drafts are included: a
draft's document is its evidence already.

**RLS**: both tables in the 0031 loop (enable + force + `tenant_isolation` +
grants) with the same `pg_class` self-check at the end of the file. Mirrors in
`packages/db/src/schema/enums.ts` and `tables.ts`, or `drift.test.ts` fails.
Both tables (and `financial_accounts`, `statements`, `statement_lines`, which
`csv-import.e2e.test.ts` notes are missing) join `TENANT_SCOPED_TABLES` in
`apps/server/src/test-support/tenant.ts` and the wipe list in
`packages/db/test/rls.test.ts`.

Two supporting indexes for the matcher, cheap now and needed at volume:
`statement_lines (tenant_id, amount_signed)` and
`documents (tenant_id, payable_amount) WHERE deleted_at IS NULL AND doc_type <> 'statement'`.

```sql
-- 0033 — goal_contributions can now be grounded (0030's deferred half)
ALTER TABLE goal_contributions DROP CONSTRAINT goal_contributions_no_statement_line_yet;
ALTER TABLE goal_contributions
  ADD CONSTRAINT goal_contributions_statement_line_grounded
    CHECK ((source = 'statement_line') = (source_statement_line_id IS NOT NULL)),
  ADD CONSTRAINT goal_contributions_statement_line_fk
    FOREIGN KEY (source_statement_line_id) REFERENCES statement_lines(id) ON DELETE RESTRICT;
CREATE INDEX goal_contributions_line_idx ON goal_contributions (source_statement_line_id)
  WHERE source_statement_line_id IS NOT NULL;
-- Constraint trigger, 0030's own style: a grounded contribution's line must be
-- money IN (amount_signed > 0), and the contributions grounded in one line may
-- not sum past it. Fires on INSERT/UPDATE of goal_contributions.
```

`ON DELETE RESTRICT`, not cascade: a statement is evidence and is not deleted,
and a contribution that names a line refuses to outlive it silently.

#### The merge rule, as a function

`mergeObservations(evidence, rules) → DraftSpec | Refusal` is **pure**: same
evidence, same rule version ⇒ byte-identical splits. That is README principle
2 (*extraction is a versioned, replayable function*) applied to posting, and
it is what makes both ordering (Q4) and reversal (Q5) fall out for free. It is
the split-building half of `draftTransactionFromDocument`, extracted without
changing its output for the receipt-only case (the existing
`transactions.test.ts` must stay green through the refactor), plus these
rules — §5.3's table, made executable:

| Field | Rule |
|---|---|
| `txn_date` | document `issue_date`; if none, line `value_date`, else line `posted_date`. **Never `current_date` when a line is present** — today's fallback would date a purchase after the money left. |
| `settled_date` | line `posted_date` (0031 named the column for this; no transformation). NULL when there is no line. |
| debit-side splits | from the document, exactly as today (subtotals → tax codes → GST control legs → rounding). With **no document**: one split to `6-0000 Uncategorised Purchases` for a debit line, or to `4-9000 Uncategorised Receipts` (income, new, via the existing `ensureAccount`) for a credit line. Sign follows `amount_signed`. |
| payment leg | **the line's `amount_signed`, straight into `financial_accounts.account_id`, no sign flip** — 0031's stated promise. Resolution order when there is no line: a `financial_accounts` row whose `account_last4 = documents.card_last4` and is the only such row → its `account_id`; else today's brand liability / Trade Creditors, unchanged. |
| amount | the **line's**, when both exist. `sum(debit side) + amount_signed ≠ 0` is an `amount_disagreement` **refusal** unless the caller supplies a human-stated `variance_kind`; then one extra split to `6-9200 Payment variance` (expense, `N-T`) for the difference, described by the kind. The matcher never supplies a variance. |
| `source` | `'scan'` with a document; `'import'` without (the enum member §2 found unset). |
| `payee_id`, `memo` | from the document as today; with no document, `memo = description_raw`, payee NULL (M10's job). |
| `currency` | document currency must equal the account's, else `currency_mismatch` refusal. FX is `foreign_fx`'s domain and outside R5. |
| `external_refs` | `{"merge":{"rule_version":"…","candidate_ids":[…]}}` — the replay stamp, the same reason `tenants.tax_rules_version` exists. |
| tax codes | selected by `tax_codes.country = tenants.country`. Today's `loadTaxCodes` reads every system code regardless of country and keys a `Map` by `code`, so `'N-T'` — present in both AU and ID sets — resolves to whichever row came last, and `taxCodeFor('S')` hands an ID tenant the Australian `GST` code, which 0026's trigger then refuses at post time. **The merge must not inherit this**; R5b fixes it at the shared helper. |

Refusals are values, not exceptions (`{ ok: false, reason }`), in the
`DraftOutcome` style the repo already uses, and each one has a test.

#### Materialisation: supersede, never edit

A posted transaction is immutable (0009 guarantee 3: *"only the second act
moves the books"*). So when an event's evidence set changes, the live
transaction is not edited — it is **superseded**, in one database transaction:

1. Build the new draft from the full evidence set with `mergeObservations`.
2. `status = 'void'`, `voided_at = now()`, `void_reason = 'superseded: <why>'`,
   `external_refs || {"superseded_by": <new id>}` on every transaction that
   currently materialises any of that evidence (there may be **two**: the
   receipt's and a line-only one).
3. Insert the new transaction and its splits; re-point the existing
   `event_observations` rows and insert the new one.
4. Post it — through the same UPDATE `postTransaction` owns today, extracted
   into a shared helper so that comment stays true. 0006's deferred trigger
   checks the balance at commit; trigger 1 above checks no link was left on a
   void row. Either failure rolls the whole act back and surfaces as the 409
   `TransactionsController#post` already emits for an unbalanced posting.

Every match therefore changes the payment leg (from a brand suspense account to
the real bank account) and so always supersedes; there is no in-place path to
keep straight. The voided rows stay as history, with the reason and the
successor on them. `review_tasks.transaction_id` and any `external_refs.xero`
would point at a voided row after a supersede — neither is written by anything
today; noted so it is not rediscovered.

Accepting a match **is** the posting act. The receipt was confirmed by a human
already (separately, as 0009 requires); the statement line is cleared money;
the person tapping *accept* is saying the two are one. It carries the same
owner/admin rule as `TransactionsController#post`. Accepting against a document
that is still `needs_review` is refused (`document_not_confirmed`) and points
at the review screen — document confirmation remains its own prior act.

#### Q4 — ordering is a non-question, by construction

The end state of an event is `mergeObservations(final evidence set)`. Arrival
order only decides *which* transactions get superseded on the way:

- **Receipt first.** Confirm → draft → post: a receipt-only transaction (today's
  path, now with its `kind = 'document'` observation row). Statement lands
  days later → candidate → accept → that transaction is superseded by the
  merged one.
- **Statement first.** Lines land; nothing posts. A line is either matched
  later (candidate → accept → merged transaction, superseding the receipt's if
  the receipt was posted in between) or posted standalone by a human act
  (`source = 'import'`, uncategorised) and matched later still — in which case
  the standalone one is superseded too.

Both roads end at the identical row set. That is the test: run the two orders
against the same fixtures and assert the final posted transaction is
split-for-split equal, with the same `txn_date`, `settled_date` and `source`,
and that every intermediate transaction is `'void'` with `superseded_by` set.

#### Q3 — flag, never auto-merge; and no number to invent

R5 **never auto-confirms**. Every `event_observations` row that involves a
statement line is created by a human accepting a candidate or making a manual
link. That is the literal reading of the column comment, and it means R5 needs
no threshold to function — the calibrated one is R7's, on labels that R5
starts accumulating on day one.

The candidate generator is a filter on **facts**, ranked for display, with no
score:

- same tenant, same currency; the line is not a live observation and the
  document is not matched;
- `amount_signed = −payable_amount` for a purchase (`payable_amount` for a
  `credit_note` — a refund);
- `card_last4`: **both present and different ⇒ excluded** (a fact — the card
  ending 9021 did not pay a docket that says 4417); both equal ⇒ recorded;
  either absent ⇒ recorded as absent. S1 is why this is available at all;
- **no date window.** `date_gap_days = posted_date − issue_date` is recorded
  and used to rank; `within_posting_lag` is a *label* from
  `statementRules.postingLagDays` when the tenant has a rule set installed
  (S4 declared it; nothing reads it yet — this is the first reader, in
  `interpreter.ts`), and **NULL when none is**. `rulesFor` throws for a tenant
  with no `tax_rules_id` (`taxrules.repo.ts:81-83`), and there is still no
  Australian rule set, so a matcher that refused without one would be dead in
  the launch market. A match suggestion is not a statutory figure, so the
  README's "no rule set → every calculation throws" does not bind it; the
  label is simply absent;
- `merchant_similarity = similarity(description_normalised, name_normalised)`
  from `pg_trgm` (enabled since 0001, unused since), recorded, not filtered on.

Ranking for display: card equal first, then `|date_gap_days|` ascending, then
similarity descending. Every candidate is shown; the page size is a UI choice,
not a threshold. Exact amount only means a tip-adjusted or surcharged line is
never *suggested* in R5 — it is linked **manually** through R8's surface, with
the variance named by the person. §5.4's tolerance is R7's number, measured.

The matcher is **idempotent** (a pair with any existing `match_candidates` row
is skipped) and runs on read — `GET …/candidates` for a statement or a document
computes what is missing first — and on document confirm. Nothing needs a hook
in `csv-import.ts` or T2's writer, both of which are being written right now;
a hook can be added once they are still.

An unconfirmed candidate is exactly that: a row in `match_candidates` with
`status = 'suggested'`, visible in the reconciliation surface, touching neither
document, line nor ledger. It expires never; it is resolved by a person or
stays a suggestion.

#### Q2 — retained and linked; how a person sees both sides

Nothing is merged and nothing is discarded. The receipt stays a `documents` row
with its capture; the statement stays a `documents` row (`doc_type =
'statement'`) with its `statements` and `statement_lines`; the link is the
`event_observations` pair on one transaction. Three read surfaces make the
link visible without a join in anyone's head:

- `GET /v1/transactions` rows gain `settledDate` and `observations[]` — each
  with `kind`, the `documentId` or `statementLineId`, and a one-line summary —
  plus `supersededBy`.
- `GET /v1/documents/:id` gains `settlement: { statementLineId, postedDate,
  accountLabel, amountSigned } | null` — *"Cleared 14 Aug via Visa ···4417"*
  on the review screen, with the statement PDF one tap away through
  `statements.document_id`.
- A statement line view carries `matchedTransactionId | null`, and from it
  the receipt.

A candidate renders as two columns — the receipt (supplier, issue date, total,
card) and the bank line (`description_raw`, posted date, amount, account) —
with the evidence facts written as words: *"same card ending 4417 · cleared two
days later"*. That is §10.5's *"suggestion with a stated reason"*; the
sentences are rendered from `evidence`, never stored.

#### Q5 — reversal is the same act, backwards

`POST /v1/reconciliation/observations/:id/unlink` (owner/admin) deletes the
statement-line observation, flips its candidate to `'unlinked'`, and
re-materialises the remaining evidence: the merged transaction is superseded
by a receipt-only one, which — by purity — is split-for-split the transaction
that existed before the match. The statement line returns to the unmatched
queue (it is **not** re-posted standalone; a person can do that again). Nothing
is deleted but the link row; the candidate row is the durable record that this
pair was once accepted and then not, which is a negative label R7 can use.

The test: match, unlink, and assert the live receipt-only transaction equals
the pre-match one on every split, that the merged one is `'void'` with
`superseded_by` pointing at it, and that the line has no observation and one
`'unlinked'` candidate.

#### Q6 — what the merge is worth in a personal workspace, with no tax figure

`tenants.kind = 'personal'` never shows GST — enforced at
`analytics.ts:300-322` and by `verify.ts`, not styled. Nothing in R5's wire
types carries a tax field at all, nullable or otherwise:
`MatchCandidateView`, `EventObservationView`, `StatementLineView` and the
`settlement` block have no `gst*` member by construction, and a test drives a
personal fixture through every new endpoint and asserts the JSON matches
neither `/gst/i` nor `/ppn/i` — then flips the fixture to `business` and
proves the same test would fail on `DocumentView.gstAtRisk`, so it is checking
something. What personal gets from the merge, in the language it is allowed:

1. **Cleared.** A receipt with a statement observation is *cleared*; one
   without, after the statement covering its date has been read, is *not seen
   by the bank yet* — R8's missing-from-bank, without a tax word.
2. **A bank row that knows what was bought.** The $84.20 line becomes
   groceries and household through the receipt's lines (R9), which is the only
   way `byCategory` (`analytics.ts:97`) stops summing everything under the
   constant `'Uncategorised'` that `documents.controller.ts:266` returns today.
3. **No double count when statements feed the summary.** `PersonalSummary` is
   derived from documents (`summaries.controller.ts:141-149`). When M9 adds
   statement spending, the merge is what stops one fuel stop counting twice —
   the unit becomes the event, not the document plus the line.
4. **A savings goal the bank agrees with.** A credit into savings grounds a
   `goal_contributions` row (below), so `goals.saved` points at a movement
   rather than a number someone typed — D16's *"a number asserted with nothing
   to point at"*, closed for goals.
5. **"No receipt for this payment."** The same row that is a substantiation
   risk in business is, in personal, a payment the person may want to look at.
   R8 owns the screen; the state exists from R5.

`settled_date` is written in personal too — it is harmless there and it is
what makes the cash-basis BAS derivable the day D34 reverses, with no backfill.

#### What grounds a goal contribution

0030 left `source_statement_line_id` with a CHECK forcing NULL *"until Lane T
shipped"*. It has. 0032/0033 above add the member, the FK and the grounding
rule. What a grounded contribution **is**: a `statement_lines` row with
`amount_signed > 0` (money in — deposit positive is `csv-import.ts#rowAmount`'s
own reading of 0006 for an asset account) on any of the tenant's
`financial_accounts`, whose amount covers every contribution grounded in it.
The server writes `amount` (default: the whole line), `occurred_on =
posted_date` and `source = 'statement_line'`; the client supplies only
`statementLineId` and, optionally, a smaller amount. A grounded contribution is
**not** an `event_observations` row: the line's economic event is a transfer or
a deposit and belongs to the ledger; "this counts toward the holiday" is an
allocation on top of it, which is what 0030 built `goal_contributions` to be.
Account type is deliberately not restricted — a deposit into a transaction
account can be a goal's — sign and sum are.

#### `dedup_group_id` gets its writer

`documents.dedup_group_id` — *"business-key fingerprint group; flag, never
auto-merge"* — is document-to-document and is **separate** from the
receipt-to-line register above. R5e gives it the writer §2 says it never had:

- receipts: `md5(tenant_id || supplier name_normalised || issue_date ||
  payable_amount)::uuid`, computed in `saveExtraction`; NULL when any part is
  missing. Byte-identical re-uploads never reach this (`captures_sha_unique`);
  this catches the re-photographed docket and the re-exported PDF.
- statements: `md5(tenant_id || financial_account_id || period_start ||
  period_end || opening_balance || closing_balance)::uuid` in the statement
  writers — 0031's own note that a re-uploaded statement flags *"through the
  EXISTING `documents.dedup_group_id` path rather than a second
  statement-shaped one"*.
- a group reaching two members raises one `review_tasks` row, `reason =
  'possible_duplicate'` (the string 0007's comment already carries), naming the
  group. Resolution is the existing reject flow on the duplicate, or "keep
  both", which resolves the task. Never auto-reject, never auto-merge, and —
  in R5 — never joined into one event (the partial unique index above).

#### What R5 deliberately does not do

- No auto-confirmation and no tolerance on amount (R7).
- No FX: a document in a different currency from the account is refused (`foreign_fx` is unread).
- No two-document events; no one-line-settles-two-receipts. The schema permits
  the second (several `statement_line` rows per transaction) because R6 needs
  it for transfers; the merge refuses it in R5.
- No categorisation from the merchant string (M10); a line-only event posts uncategorised.
- No matching of a line to a **hand-typed** transaction (`source = 'manual'`).
  That needs a rule for which of a person's own splits is the payment leg to
  replace, and it is Lane M's to state; the register's shape does not preclude
  it.
- No change to how a document becomes confirmed.
- No `audit_log` writes: nothing in `apps/server` writes that table today and
  R5 does not invent the idiom; the candidate rows, `void_reason` and
  `superseded_by` are the record.

#### Found while designing, all pre-existing

- `loadTaxCodes` ignores `tax_codes.country` (above). Live for any ID tenant
  that posts a standard-rated document today.
- `draftTransactionFromDocument` dates an undated receipt `current_date`.
- Brand-derived liabilities (`2-11VI …`) are a suspense account for "paid by a
  card we have no statement for", and will coexist with the real
  `financial_accounts` ledger account for the same card until R6/M9 decide
  whether to fold them.
- T5's placeholder `financial_accounts` row (*"(unassigned — auto-created for
  CSV import)"*) has no CRUD surface; every CSV line lands on it, so matched
  payment legs post to a placeholder asset account until one exists.
- `apps/server/src/test-support/tenant.ts` does not wipe the three 0031 tables.

### 5.4 The match key nobody else has

Matching on amount and date alone is what every incumbent does, and it is weak:
four $12.50 coffees in one week are indistinguishable.

This schema already reaches further. `documents.card_last4` and `card_brand`
exist and the documented extraction contract already **requires** them (§2).
Statements print the card too. So the candidate key is:

```
amount (exact, or within a stated tolerance for tips/FX)
  ∧ date within a window (posting lag: typically 0–3 days, longer over weekends)
  ∧ card_last4 equal where BOTH sides have it
  ∧ merchant similarity  (pg_trgm, already enabled, currently unused)
```

Card last-4 collapses the coffee ambiguity for anyone with more than one card,
and it costs nothing: the field is in the schema, the model is already asked for
it, and only the wiring is absent.

**Never auto-confirm below a threshold**, and make the threshold a stated
false-match rate rather than a number someone liked. The existing
`LOW_CONFIDENCE_THRESHOLD = 0.8` is labelled a placeholder in
`packages/docai/src/pipeline.ts`; this must not become a second one. Unlike
extraction confidence, a match threshold **can** be measured without a gold set:
a confirmed match and a rejected suggestion are both labels the user generates
for free, and they accumulate from the first day of use.

### 5.5 Categorisation that improves

Three layers, cheapest first, each auditable:

1. **Deterministic rules**, per tenant, learned from confirmations: normalised
   merchant string → category, with a hit count and a last-seen date. After a
   user categorises "BP CONNECT" twice, the third is automatic and the app can
   say *why* — *"you categorised this merchant as Fuel 11 times."*
2. **The receipt, when one is matched.** A matched receipt's per-line categories
   beat any merchant-level guess, because a Bunnings docket is genuinely three
   categories and the merchant name cannot know that. This is the wedge
   capability applied to statement data.
3. **The model**, only for rows the first two cannot place — which after a few
   months is the tail, not the bulk. That ordering is `pipeline.ts`'s existing
   cheapest-capable-first principle applied to categorisation instead of reading.

Layer 1 is where "smarter along the way" actually lives, and it is **the mining
of `document_field_corrections` that the schema comment has been asking for since
it was written**. It is deterministic, per-tenant, replayable and explainable —
no model weights, nothing to drift, and every automatic categorisation can name
the rule that produced it.

### 5.6 Four intake modes, and the one that cannot self-verify

Statements arrive by four routes (D-S3): an uploaded PDF, some other uploaded
file, a CSV export from internet banking, and a page photographed or scanned with
the app's own camera. No bank feed (§13). These are not four skins on one
pipeline. They differ in whether anything is *extracted* at all, and therefore in
whether §4's balance identity is available to grade the read.

**What intake accepts today, and the hole in it.** There is one client entry
point. `apps/mobile/src/app/(tabs)/capture.tsx:181` sets
`input.accept = 'image/*,application/pdf'` — no CSV, no spreadsheet — and that
picker is reached only on web: `shoot()` (`capture.tsx:203-204`) returns
`pickFileOnWeb()` when `Platform.OS === 'web'` and otherwise goes straight to
`camera.current?.takePictureAsync` (`capture.tsx:206`). No document-picker or
image-picker dependency exists anywhere in `apps/mobile`.

> **On a handset, modes (a), (b) and (c) have no route at all today. Only the
> camera does.** The browser build can upload a file; the phone app cannot open
> one. This is the single largest piece of unbudgeted work the intake decision
> exposes, and it is client work rather than engine work — which is not where the
> rest of this plan's weight sits.

The server agrees, in two places. `captures.controller.ts:58-61` validates the
declared MIME against `^(image\/[a-z0-9.+-]+|application\/pdf)$`, and
`captures.controller.ts:251-254` re-checks the real `Content-Type` on the bytes.
`text/csv` is refused at both gates with a 400 — the right behaviour, and worth
saying plainly: CSV is not silently mis-handled today, it is declined. Three
further constraints bind any statement work: a PDF must be the only page in its
capture (`captures.controller.ts:266`), a page is capped at 30 MB (`:66`), and a
capture at 20 declared pages (`:79`). **A 40-page annual statement does not fit
under the current caps** and something has to give.

**What the PDF path already distinguishes.** `apps/server/src/extraction/pdf.ts`
classifies each page by inspection: ≥ 20 characters of embedded text
(`pdf.ts:71`, `NATIVE_TEXT_THRESHOLD`) makes it `pdf_native`, otherwise
`pdf_render` (`pdf.ts:133-141`). Both are rasterised regardless, because no
reading stage yet trusts the text layer directly (`pdf.ts:18-26`; asserted at
`extraction/pdf.test.ts:69`), and the classification is tested four ways
(`pdf.test.ts:60,78,87,99`). Mode (a) therefore already splits into the two
regimes of §9.1, and mode (d) lands as `capture` or `pdf_render` pages on the
full OCR path.

`PageSource` is `'capture' | 'pdf_native' | 'pdf_render'`
(`packages/api-contract/src/index.ts:45`). There is no member for a row dump,
because nothing in the repository parses one. Grepped across `apps/` and
`packages/`: CSV exists only as an **output** — `apps/server/src/export/pack.ts:67`
writes one, `apps/mobile/src/lib/share.ts:30,106` shares one — and no
CSV-parsing dependency is declared in any `package.json`. Mode (c) is unbuilt in
both directions.

#### The cheapest mode is the one that cannot prove it was read correctly

§4 rests on `opening_balance + Σ credits − Σ debits = closing_balance`, plus the
per-row check the printed running-balance column allows. **A CSV export very
often carries neither.** It is a row dump: many internet-banking exports emit
date, description and amount and stop, with no opening or closing figure anywhere
in the file and, on some, no running-balance column either. Where that holds,
§4's control is not weakened but **absent** — the terms of the equation are not
present to sum.

What survives is real and should be named. A CSV needs no extraction, so
**row-level exactness is free**: no reading step happened, so there is nothing to
misread — no transposed digit, no merged row, no fabricated line. Character
accuracy is exact by construction as it is for `pdf_native`, and unlike
`pdf_native` it is exact *structurally* too, because columns are delimited rather
than inferred from glyph positions.

What does not survive is **completeness**, which is the half §4 was relied on
for. A CSV truncated by a date-range filter, a pagination cap, or a download that
stopped early is byte-for-byte indistinguishable from a complete one; so is one
the user edited. Every row is right and the set of rows is wrong, with no
arithmetic in the file to say so. **The cheapest intake mode is the one with the
least ability to prove it was read correctly**, and it fails in the direction —
missing money — that matters most.

The other CSV hazards are ordinary, but each needs a decision rather than a
default: no fixed schema (column names, order and count vary by institution and
by account type within one institution, so a header-sniffing reader is the only
workable shape and it will meet headers it does not know); ambiguous dates
(`03/04/2026` is 3 April or 4 March and the file does not say — where every row
is ≤ 12 in both positions it is undecidable from the file alone, and the
account's jurisdiction is a prior, not a proof — and D-S1 means both a day-first
and a day-first-but-differently market, so this cannot be waved through);
separate debit and credit columns versus one signed column, with sign conventions
differing between them, including credit-card exports where a purchase is
positive — §6 fixes the internal convention from `0006_ledger.sql`, and a mapping
error flips every row at once, silently; and encoding (non-UTF-8 exports, BOMs,
semicolon delimiters from locales where the comma is the decimal mark).

Mode (d) is the mirror image. A photographed or scanned statement is the most
expensive read in the set — full OCR and VLM, every character recognised rather
than extracted — and **§4 applies to it at full strength**, because the opening
and closing balances are printed on the paper. Cost and verifiability run in
opposite directions across these four modes.

| Mode | Extraction needed | Character accuracy | §4 balance check | Dominant failure mode |
|---|---|---|---|---|
| (a) PDF, `pdf_native` | Structure only — columns, wrapped rows, page breaks | Exact by construction (`pdf.ts:133-141`) | **Full** | Column and row mis-assignment; the page-boundary stitch (§9.3) |
| (d) Photograph or scan, and PDF `pdf_render` | Full OCR and VLM | Recognised, not exact | **Full** | Misread digits, dropped rows — each breaks the residual |
| (b) Other uploaded file | Depends on the format, which is unspecified | Unknown | Unknown | Accepting a format for which no reader was stated |
| (c) CSV export | **None** | Exact, and structurally exact | **Weak or absent** — often no opening/closing, sometimes no running balance | **Silent truncation**; sign and date-format inversion |

Two consequences, and neither is optional if mode (c) ships. First, a CSV import
must **record what it could not check** rather than quietly claim a clean read:
the `statements.balance_check` verdict proposed in §5.1 needs a third state — not
pass or residual, but *unverifiable, because the file carried no balances* — and
it must reach the UI. Second, the compensating controls are precisely the ones
the file cannot supply: a user-stated opening balance, continuity against the
previous statement's closing figure for the same account, and gap detection on
the running-balance column where one exists. All three are weaker than the
printed identity. None of this argues against building mode (c) — it is the
fastest route to volume — only that it must not inherit §4's confidence, and
`txn_source`'s existing `'import'` member
(`packages/db/migrations/0001_extensions_domains_enums.sql:36`) is where that
difference should become visible in the ledger.

**Mode (b), "some other uploaded file", is not specified and should not stay that
way.** A format with no named reader is an open-ended promise; the table above
marks it unknown on every axis deliberately. Either it resolves to a listed
format or it is not an intake mode.

---

## 6. Money in, debit and credit

Once `statement_lines` exists with a signed amount, money in is a query, not a
feature. What needs designing is what it is *called*, because the classification
matters more than the number:

- **Income** — salary, client payments, platform payouts. Tax-relevant in both
  jurisdictions and currently invisible to the app.
- **Transfers between the user's own accounts** — these are **not** income and
  **not** spending, and getting this wrong is the single most common way a
  personal finance tracker loses trust. A transfer appears as a debit on one
  statement and a credit on another; both are the same event and it must be
  matched like any other duplicate — the same `event_observations` machinery,
  with the two statement lines as the two observations. In double entry it is a
  transfer between two asset accounts, which nets to zero and touches no expense
  or income account. The schema's split comment already anticipates this: a split
  with `tax_code_id IS NULL` is *"the GST control-account posting (or a transfer
  leg)"*.
- **Refunds and reversals** — a credit that offsets an earlier debit, not income.
  Must reduce the category it reversed, or every refund inflates both totals.
- **Credit-card payments** — paying the card from the bank is a transfer between
  an asset and a liability. Counting it as spending double-counts every purchase
  on the card, which is the classic failure of this feature class.

**Sign convention:** the ledger is already *debits positive, credits negative*,
stated in `0006_ledger.sql`. Statement lines must use that same convention
internally regardless of how the bank prints them — banks vary, including within
one institution between account types. Normalise at intake, keep the raw printed
form for the record.

---

## 7. What this does for the tax tracker

### 7.1 Australia

`settled_date` is the column *"cash-basis GST filters on"*, and
nothing writes it — so a cash-basis BAS is currently not derivable, and most
sole traders are cash basis. Statement matching is what populates it. Separately,
the missing-substantiation flag (§5.3) is directly a BAS quality control: a
statement line claiming a GST credit with no valid tax invoice behind it is
exactly what an ATO review finds, and the app would be able to list them before
lodgement rather than after an audit.

### 7.2 Indonesia

`docs/INDONESIA.md` §2.3 records a live arithmetic defect: PPN under DPP Nilai
Lain is `11/111` of an inclusive total, not `1/11`, and
`packages/api-contract/src/money.ts:65-72` and `packages/db/src/money.ts:88-94`
both hardcode `(abs × 2 + 11) / 22` — re-confirmed on this branch. That document
calls it *"the one item that is a defect under every option"* — including the
option of building nothing Indonesian. **It should be fixed regardless of whether
this plan proceeds**; D-S1 makes it a prerequisite. Ticket `S2`.

`@snap/tax-rules` is the right home for the jurisdiction-varying parts of
statement handling too, and §7.4 shows it already carries most of them. Rules are
data there, and that property should not be broken by the first statement feature
that wants an `if`.

### 7.3 What per-category splitting means in a personal workspace

D-S2 ships personal first and D-S4 folds `docs/GAPS.md` E1 — *"make
`document_tax_subtotals` (Peppol BG-23) visible in the review UI and the BAS pack
as the named feature"* (`docs/GAPS.md:456`) — into Lane R. The two decisions are
compatible, but not for free, and the cost has to be stated before the lane is
planned around it.

**In a personal workspace the app does not show a tax position, by contract.**
`AnalyticsSummary` (`packages/api-contract/src/index.ts:582`) carries the split
figures under an explicit comment at `:597-599`:

```
/** Business only. null in the personal workspace, which never shows GST. */
gstClaimable: string | null;
gstAtRisk: string | null;
```

The implementation honours it at `packages/api-contract/src/analytics.ts:300`
(`const business = workspace === 'business'`) and `:317-322`, and
`PersonalSummary` (`index.ts:554`) has no tax field at all. The client holds the
same line: `apps/mobile/src/config.ts:22` sets `BUSINESS_FEATURES_ENABLED = false`
and thirteen screens return `<Redirect href="/" />` behind it — including
`apps/mobile/src/app/tax.tsx:38` and `taxpack.tsx:33`, which are the two surfaces
E1 names. `docs/ECOSYSTEM.md` D34 records why business is dark behind a flag
rather than deleted, and notes that it hides the practice channel
`docs/MONETISATION.md` §3 calls the primary revenue line.

**And the rule engine refuses to make it a tax feature anyway.**
`packages/tax-rules/README.md:78-80`:

> **A personal rule set cannot mark consumption tax recoverable**, and cannot
> declare a filing period for it. A rule set that says both describes two
> different taxpayers.

That is enforced, not documented. `packages/tax-rules/src/verify.ts:153-159`
rejects `scope: 'personal'` with `consumptionTax.recoverable === true`; `:341-347`
rejects a filing period for a non-recoverable tax; `:369-376` rejects a tax code
with `claimsCredit: true` under the same condition. Three tests fire those guards
(`registry.test.ts:50`, `:63`, `id-2026.test.ts:40`). And `rules/id-2026.ts` is
`scope: 'personal'` (`:51`) — it *does* declare PPN at 12% on an 11/12 base, but
with `recoverable: false` (`:83`) and `consumptionTaxPeriod: 'none'` (`:264`),
its header comment allowing the app to report PPN *"as an analytic ('you paid
this much PPN') but never as a credit, a claim or a return line."*

**The mechanism still pays for itself in personal — as categorisation, not tax.**
A supermarket docket genuinely spans several *spending* categories, and a single
bank row for $84.20 cannot know that. `document_lines.category_id`
(`packages/db/src/schema/tables.ts:391`) resolves it; `document_tax_subtotals`
(`:395`) is the same per-line pass seen through a tax lens. §5.5 layer 2 already
makes this argument for statements, and it holds with the word *GST* removed:
mis-categorised groceries break `safeToSpendPerDay` exactly as a mis-claimed
credit would break a BAS.

So **E1-in-Lane-R means: build the per-line split once, surface it twice.**

#### The half of E1 that does not ship

`docs/GAPS.md:451` records that the market scan of 12 September 2026 found *"no
competitor at any price"* offering per-category tax subtotals, and §8's first
differentiator leans on it. **That is a business claim** — claimable GST on a
mixed tradie docket, landing in the review UI and the BAS pack, both behind
`BUSINESS_FEATURES_ENABLED`. Building the split under a personal-first release
produces the capability and **withholds the differentiator**. The market-scan line
cannot be used in any personal-facing pitch without becoming a claim the app does
not make.

Defensible — D34 already accepted a larger version of the same trade — but it
should be taken knowingly rather than discovered when someone asks why the
flagship capability is invisible.

**Two places the repository does not hold the line it states.** Both are the
repo's own signature failure shape and both predate this plan:

1. `apps/mobile/src/app/document/[id].tsx:291-315` already renders
   `doc.taxSubtotals` as *"Split by tax treatment"*, labelled `GST-free` /
   `Taxable` with the hint *"Carries $X of GST"* — gated on
   `doc.taxSubtotals.length > 1` **and nothing else**. Not on workspace kind, not
   on the flag. So part of E1's review-UI half is already built, and it emits GST
   language on a path a personal workspace can reach. The contract comment at
   `index.ts:597` is narrower than the app's actual behaviour.
2. The refusal is asserted only half-way, and on the BAS path not at all.
   `apps/mobile/src/lib/analytics.test.ts:231` checks `gstClaimable` is null in
   personal at `:235` and never checks `gstAtRisk`. Worse:
   `BasSummary.gstClaimable` is **non-nullable** (`index.ts:429-430`),
   `apps/server/src/summaries/summaries.controller.ts:70-101` applies no workspace
   test — unlike the analytics handler at `:169`, which reads
   `tenant?.kind === 'personal'` — and `apps/server/src/summaries/` has no test
   file. **Today the personal BAS refusal is a client redirect, not a contract.**

### 7.4 Both markets means the jurisdiction is a parameter, starting now

D-S1 makes `docs/INDONESIA.md` §11's option **B** the floor. The argument for
doing it at the start rather than retrofitting is the one that document makes
about the corpus (§9.2), applied to code: **with one jurisdiction live, an
Australian constant and a universal constant are indistinguishable by
observation.** A second market converts each hardcode from an opinion into a
failing test.

**`docs/INDONESIA.md` §8's inventory is out of date, and in our favour.** It was
compiled on `feat/web-3d-spike` and says the seams exist but *"what is missing is
anything that reads them — `country` is currently a stored fact with no behaviour
attached."* Re-checked on this branch, that is **no longer true**: there is a
`taxrules` module whose own comment at
`apps/server/src/taxrules/taxrules.controller.ts:99` says it *"reads
`tenants.country` and acts on it"*, with a repo (`taxrules.repo.ts:62,121,222`)
and an e2e test asserting `country` is `'ID'`
(`taxrules.e2e.test.ts:179`).

More importantly, `packages/tax-rules/src/contract.ts` already expresses most of
what statement handling needs. Verified by reading it:

| Parameter statements need | AU | ID | Expressible in `contract.ts` today? |
|---|---|---|---|
| Tax inside an inclusive total | 1/11 | 11/111 | **Yes** — `inclusiveFraction` (`:124`), declared not derived, with `contract.test.ts` asserting it agrees with `statutoryRate × baseFraction` |
| Rate applied to what share of price | 1/1 | 11/12 (DPP Nilai Lain) | **Yes** — `baseFraction` (`:113`) |
| Date order for ambiguous `03/04/2026` | day-first | day-first | **Yes** — `dateOrder` (`:348`), plus `PeriodSpec` (`:365`) whose comment already describes using the reporting period as the tie-breaker |
| Retention period | 5 years | 10 years, unresolved | **Yes** — `retentionYears` (`:337`) and `staleAfterYears` (`:339`) |
| Decimal and thousands separators | `.` / `,` | `,` / `.` | **Yes** — `CurrencySpec` (`:73-74`) |
| Cash-rounding increment | 5c | — | **Yes** — `tillRounding` (`:80`) |
| Exempt categories for the per-line split | GST-free | PP 49/2022 basics | **Yes** — `exemptCategories` (`:140`), commented *"for the per-line split"* |
| Recoverability | registered only | PKP only | **Yes** — `recoverable` (`:138`) |
| **Statement posting-lag window** | 0–3 days (estimated) | unknown | **Yes, since S4** — `statementRules.postingLagDays` |
| **Bank-interest treatment** | final withholding, 20% (PP 131/2000) | — | **Yes, since S4** — `statementRules.bankInterest` |

So the parameterisation work is smaller than `INDONESIA.md` §8 implies, and it is
concentrated in one place: **`gstFromInclusive` still hardcodes 1/11 and does not
read `inclusiveFraction`.** Confirmed on this branch at
`packages/api-contract/src/money.ts:65-72` — the comment reads *"exactly 1/11"* —
and identically at `packages/db/src/money.ts:88-94`. The rule set can already say
the right number; two functions do not ask it.

**Why this matters specifically for statements, and not only for receipts.** A
statement line's amount is inclusive of tax by nature — the bank cleared the
gross figure — so deriving any tax component from a statement row *is* exactly
this computation. And `docs/INDONESIA.md` §2.3 records that under DPP Nilai Lain
the identity `taxable + tax = inclusive` is **false by construction**, which
`apps/server/src/extraction/tax-subtotals.ts` relies on directly. On the AU path
that identity is safe; on the ID path a statement-derived subtotal computed the
existing way is wrong in a way nothing currently detects.

Two honesty notes. The Indonesian rates and the DPP mechanism are taken from
`docs/INDONESIA.md` §2, which carries its own sources and its own §10 list of
weak ones — they are not independently verified here. And the 0–3 day posting-lag
figure is an **estimate**, varying by institution and product; it is listed above
as a parameter precisely so it does not become a constant somebody guessed.

---

## 8. Against the market — where this is actually differentiated

Stated plainly, including where it is not.

**Not differentiated:** reading a statement PDF. Every bookkeeping tool does it,
several free ones do it well, and in markets with open banking it is largely
obsolete — a feed is better than a PDF in every respect. `docs/MONETISATION.md`
§1's discipline applies: do not build something the incumbent gives away.

**Differentiated, and defensible:**

1. **Per-category tax subtotals surviving the match.** Every competitor
   reconciles a statement line to a receipt *total*. `document_tax_subtotals`
   means a matched Bunnings line can still be split into its taxable and
   GST-free halves against a single bank row. The market scan of 12 September
   2026 found no competitor at any price doing the split at all — doing it
   *through* a reconciliation is further still.
2. **The double-entry ledger with a database-enforced balance.** Most personal
   trackers are single-entry lists. This one cannot silently lose a transfer.
3. **The self-verifying read (§4).** A tool that can say *"this statement
   balances, so the read is arithmetically complete"* is making a claim its
   competitors' confidence scores cannot.
4. **Evidence retained forever, immutable, with the tax treatment attached.**
   The existing product principle, extended to the bank record.

**The honest counterweight, and D-S2 sharpens it.** Items 1 and 4 are
practice-channel arguments, and `docs/GAPS.md` E2 says plainly that provenance
and compliance language is *"for a buyer we are not selling to"* until the
corrections-per-100 number exists. Personal-first means the first release is sold
on item 3 plus the money-in view — **the weaker of the two pitches**, and the one
that competes with a crowded category of free consumer trackers rather than with
Dext and Hubdoc.

That is a real cost of the decision and it should be visible rather than
discovered later. The counter-argument, which is not nothing: the reconciliation
machinery is identical across both, so personal-first buys the engine and the
match quality on a lower-stakes audience before the practice channel ever sees
it. The failure mode to watch is shipping a consumer tracker well enough that the
practice pitch never gets built.

---

## 9. What this means for OCR and the VLM

The request asks for top-of-class OCR and VLM. Most of that work is **already
specified** in `docs/OCR.md` and `docs/GAPS.md`, some of it is already built and
deliberately unwired, and statements change the argument for three specific
tickets. This section does not propose new engine work; it proposes that
statements are the document class that settles three open questions.

### 9.1 Statements mostly need no OCR at all

`pdf.ts` classifies a page with a real text layer as `pdf_native`. A bank
statement downloaded from internet banking is that. The text is *exact* — not
recognised, extracted — so character accuracy is 100% by construction and the
remaining problem is purely **structure**: which text belongs to which column,
which rows wrapped, where the table continues across a page break.

That makes statements the natural home for `docs/GAPS.md` **C3** (promote the
OCR/layout stage to primary, demote the VLM to escalation). On a photographed
docket, C3 is blocked on detection recall clearing a bar it has not cleared
(0.875, and the ticket says explicitly *"do not promote on 0.875"*). On a
text-layer PDF, **recall is 1.0 and that precondition is satisfied trivially.**

A photographed or scanned statement is the harder case and still needs the OCR
path — but it is the minority, and routing by `pdf_native` vs `pdf_render` is
already implemented.

### 9.2 Statements are the case that justifies grounded extraction

`docs/GAPS.md` **C1** — the extractor points at spans instead of reading pixels —
is built (`extraction/grounded.ts`), measured, and deliberately **not adopted**.
The measurement on 24 receipts found it bought nothing: zero hallucinations
either way, and `minimax-m3` fell from 87 correct to 69. The ticket's own note
says what would change the answer, first item: *"a case where free reading
actually fabricates."*

**A 300-row statement table is that case, and the reasons are structural, not
hopeful.** Long homogeneous tables are where language models drop rows, merge
adjacent rows, and continue a plausible sequence past the end of the real data —
failure modes a 20-line receipt does not exercise. And here, unlike on receipts,
**the fabrication is detectable without ground truth**: an invented row breaks
the balance identity (§4).

So the C1 experiment can be re-run on statements with a decisive outcome either
way, cheaply, using code that already exists. That is worth more than re-arguing
it. **Stated as a prediction in advance, so it cannot be claimed afterwards
either way:** if grounded pointing does not reduce the balance-residual rate on
statements, C1 should be closed as measured-and-not-adopted rather than left
open indefinitely.

### 9.3 Chunking is mandatory, and it is where correctness will be lost

§5.2's truncation point restated as an engine concern: the statement path must
read per page and stitch. The stitch is the risk — a dropped page boundary loses
rows silently and the running balance is the only thing that will notice. The
balance check must therefore run across the **whole statement**, not per page,
or the control does not cover the failure it exists to catch.

### 9.4 It produces real corpus, which is the scarce thing

`docs/ROADMAP.md` §5 names the blocker: every commercial number is unmeasured
because there are only four synthetic bench documents and B1 needs ≥ 40 real
Australian ones that must be physically photographed.

A statement is **real paper that carries its own ground truth for the numeric
fields.** Not for descriptions, and not a substitute for B1 — the tier rules in
`docs/CORPUS.md` §4 bind here exactly as they do everywhere, and a statement
corpus is Tier P or R by its own origin, with `provenance.tier` required and no
default. But it is real, self-labelling numeric data in volume, obtained without
a photography session.

**The control that must come with it:** `docs/CORPUS.md` §4's rule that headline
metrics refuse to emit below Tier R applies unchanged, and `docs/INDONESIA.md`
§9.4's proposed tightening — Tier R requires `captured_in == "AU"` — should land
with it. A statement corpus makes it easier to accidentally quote a number from
non-Australian paper, so the assertion gets *more* load-bearing, not less.

---

## 10. Risks, and the things that will go wrong

Named in advance, because each is cheaper to design around than to discover.

1. **This is the most sensitive data in the product.** A statement is a complete
   financial history, not one purchase. Account numbers must be stored masked —
   the `card_last4` rule, extended. Retention differs by jurisdiction (5 years
   AU; `docs/INDONESIA.md` §10.5 flags 10 vs 5 as unresolved for ID). Any export
   or support-impersonation path (`impersonation_sessions` exists) needs revisiting
   before statements are in it. **This deserves its own review, not a paragraph.**
2. **Statement layouts vary enormously and change without notice.** Per-bank
   templates rot. A generic reader that degrades gracefully and a balance check
   that catches the degradation is more durable than per-bank parsers — but the
   accuracy ceiling is lower, and that trade should be made deliberately.
3. **Passworded PDFs are the norm** at several institutions — commonly the user's
   date of birth or ID number. The intake flow must handle a password prompt, and
   must not store the password.
4. **Uploading a statement is a hostile onboarding step.** Photographing a
   receipt takes four seconds. Finding, downloading and uploading a PDF from
   internet banking is a multi-minute chore in another app. If the feature
   depends on users doing that monthly, adoption will be the binding constraint,
   not accuracy. Worth prototyping the flow before building the engine.
5. **Reconciliation UI is where finance apps go to die.** Two lists and a "match"
   button is a spreadsheet. The interesting surface is *suggestion with a stated
   reason* — *"matched to your Ampol receipt: same card ending 4417, $84.20, two
   days earlier"* — and a one-tap reject that feeds §5.5. `docs/DESIGN-HANDOFF.md`
   §12's open aesthetic questions apply, and none of them is settled.
6. **The credit-card payment double-count (§6)** will happen if the transfer
   model is added later rather than first. It makes every number in the app wrong
   at once, and it is the failure users notice immediately and never forgive.
7. **Scope.** The ask contains "make everything top of class." `docs/GAPS.md` is
   already an ordered queue of exactly that work, gated, and its own §5 says one
   unphotographed gold set blocks most of it. Statements do not unblock B1. They
   route around it for one document class. Saying otherwise would repeat the
   pattern both `DEPLOY.md` §8 and `GAPS.md` were written to stop.

---

## 11. On "top of class", answered directly

The honest decomposition of the fifth request:

| Claim | What it actually needs | State |
|---|---|---|
| Top-class OCR | A2/A4 measured on a corpus that can resolve the difference | **Blocked on the OCR truth corpus**, which is one page (GAPS A2's note) |
| Top-class VLM extraction | B2 head-to-head on real paper | **Blocked on B1** |
| Confidence that means something | B3 calibration | **Blocked on B1, B2** |
| "Fewer corrections than Dext" | B4 + E2 | **Blocked on B1** |
| Top-class finance tracker | Money in, transfers, reconciliation | **Not blocked** — this plan |
| Top-class tax tracker | `settled_date` for cash-basis; the PPN fix; substantiation flags | **Not blocked** — §7 |
| The one capability nobody has | E1: per-category subtotals visible in the review UI and BAS pack | **Not blocked, not built.** Folded into Lane R by D-S4 — and its business half deferred by D-S2, see §7.3 |

Four of seven rows terminate at the same ticket, and it is a photography session.
**The most valuable thing anyone could do for "top of class" is B1**, and this
plan does not change that. What this plan offers is the largest body of
substantial work that is genuinely independent of it.

---

## 12. Proposed queue

Lanes, in dependency order. Every ticket carries a **done when** in the house
style: if it cannot be checked, it is not closed. Effort is deliberately
unestimated — sequence is the claim here, not duration.

The decisions in §14.1 move two things. **D-S1 pulls the jurisdiction work
forward**: `S2` and `S3` now sit ahead of Lane T rather than beside it, because
parameterising after the statement code exists means retrofitting it — and `S3`
is a defect that statements would inherit. **D-S3 adds `T5`, `T6` and `T7`**: the
CSV path, the missing file picker on the handset, and the page caps. `R9` is
`GAPS.md` E1, folded in per D-S4.

`T6` is the one to look at hardest. It is the only ticket here that is pure client
work, it was invisible until the intake decision was made concrete, and without it
three of the four decided intake modes have no route on a phone.

**Lane R was re-cut on 2026-09-18** against §5.3.1: `R5` is now an umbrella
over `R5a`–`R5h`, in dependency order, and `R6`–`R9` each say which piece of
`R5` they stand on. The umbrella's *done when* is unchanged; it closes when
`R5h` does. Two questions that re-cut could not settle are §14.2 items 4 and 5.

### Lane S — Make the existing contract true first

**S0 — The documented extraction schema and the implemented one must agree.**
`docs/extraction-schema.json` requires `payment`, `bbox`, `tax_subtotals`,
`rounding_amount`, `due_date`; `extraction/types.ts` has none of them (§2).
*Do:* either implement the fields or amend the document, and add a test that
fails when the two diverge. *Done when:* a test reads the JSON schema's required
list and asserts the TypeScript type covers it — verified by deleting a field and
watching it fail. *Blocks:* everything, because the statement schema is the
second contract in this file and must not inherit the defect.

**DONE 2026-09-18.** Built as a GENERAL contract test, not five special cases:
`schema-contract.test.ts` walks every path the JSON marks required and demands a
recorded decision — `mapped` (proven by running the real `parseExtraction`) or
`excluded` with a reason. An undecided required path fails the suite, so the
statement schema cannot inherit this defect on day one.

Implemented: `payment` (method/card_last4/card_brand), `rounding_amount`,
`due_date`. Amended instead: `tax_subtotals` left `required` — it is *derived*
by `taxSubtotalsFromLines()`, never asked of the model, because per-cent GST
arithmetic is what code is exact at and a vision model is not; `minItems` was
also wrong at 1 and is now 0. `bbox` was never in a `required` array at all —
the divergence was the prose overclaiming *"EVERY value carries a bounding
box"*. Grounding lives in OD-7's separate pipeline, and GAPS C1 measured that it
bought nothing (87→69 correct), so it stays optional.

*Finding:* `due_date` was never in the `required` array either, despite §2 above
saying so. §2 was wrong; most receipts have no due date.

**S1 — Persist `card_last4` and `card_brand`.** The model is already asked for
them; the columns exist. *Done when:* a captured card receipt has a non-null
`card_last4` in the database. *Blocks:* R7's match key.

**DONE 2026-09-18.** Masked PAN enforced three times, not once: at parse time in
`provider.ts`, AGAIN at the write boundary in `saveExtraction` (a
`ValidatedExtraction` is a public type and three existing fixtures build one by
hand, bypassing the parser), and by `documents.card_last4` being `CHAR(4)` so a
bug in both still fails the insert. Verified with a Luhn-shaped 16-digit test PAN
pushed through `saveExtraction` against real Postgres: stored value `'1111'`.
No migration — every column already existed and was written by nothing.

*Newly live, worth watching:* `transactions.repo.ts` maps card brand to a
liability account (`2-11${brand}`). `card_brand` was `NULL` on every row until
now, so that rule has never run on real data.

**S2 — `gstFromInclusive` must ask the rule set instead of hardcoding 1/11.**
Confirmed live on this branch at `packages/api-contract/src/money.ts:65-72`
(*"exactly 1/11"*) and `packages/db/src/money.ts:88-94`. The rule set can already
state the right number — `ConsumptionTaxSpec.inclusiveFraction`
(`packages/tax-rules/src/contract.ts:124`) — and neither function asks. A money
defect under every option in `docs/INDONESIA.md` §11, including doing nothing
Indonesian. *Do:* read `inclusiveFraction` from the installed rule set. *Done
when:* a test asserts `11/111` under `id-2026` and `1/11` under the AU rule set
from the same call, **and** a second test asserts the function **refuses** rather
than defaulting when no rule set is installed — the registry's existing discipline
(`packages/tax-rules/README.md`: *"No rule set installed → every calculation
throws. There is deliberately no fallback"*), because a silent 1/11 fallback is
the exact failure that rule states.

**S3 — `taxable + tax = inclusive` must stop being assumed.** §7.4.
`apps/server/src/extraction/tax-subtotals.ts` derives `taxableAmount` by
subtracting tax from the inclusive total. Per `docs/INDONESIA.md` §2.3 that
identity is false by construction under DPP Nilai Lain, and a statement line is
inclusive by nature, so statement-derived subtotals inherit the defect. *Do:*
derive the taxable base from `baseFraction` (`contract.ts:113`) rather than by
subtraction. *Done when:* a test feeds an Indonesian faktur's printed figures
through and asserts the emitted `taxable_amount` matches the printed DPP rather
than `payable − tax` — the two differ by construction, so the test fails today and
is a genuine check rather than a restatement. *Blocks:* any tax figure derived
from a statement row in the ID market.

**S4 — Statement parameters the contract cannot yet express.** §7.4's last two
rows: posting-lag window and bank-interest treatment have no home in
`contract.ts`. The README's rule governs — *"If a jurisdiction needs a rule the
contract cannot express, widen the contract and the interpreter"*; a rule set that
needs its own logic has become code. *Do:* widen `contract.ts` for these two
before Lane R needs them. *Done when:* both are declared per rule set, `verify.ts`
refuses a rule set that omits them, and a test fires that refusal.

**DONE 2026-09-18.** `statementRules` on `TaxRules` carries `postingLagDays` and
`bankInterest`; `verify.ts` refuses a rule set that omits it, an inverted
`postingLagDays` range, a `final_withholding` with no rate, and a rate stated for
any other kind. The refusal was verified by gutting the check and watching
`expected [] to include 'statementRules'` fail, then restoring. `id-2026` declares
0–3 days (an **estimate**, varying by institution — not a measurement) and interest
as final withholding at 20% under PP 131/2000.

*Note for Lane R:* `interpreter.ts` does not yet READ either field. Nothing
consumes them, so nothing was wired — declaration and refusal only. Lane R must
add the reading, and this line exists so that is not mistaken for done.

*And note what did not happen:* there is still no Australian rule set in
`packages/tax-rules` — the README's *"Australia stays where it is"* stands, so
"both shipped rule sets" is one rule set today.

### Lane T — Read a statement

**T1 — Classify statements at intake and route them.** `doc_type = 'statement'`
exists and nothing branches on it. *Done when:* a statement PDF and a receipt
photo take measurably different paths, proven by a test asserting the receipt
schema is never applied to a statement.

**T2 — `statement-schema.json` and the per-page extraction path.** §5.2.
*Done when:* a 10+ page statement extracts without a `TruncatedOutputError`, and
a test proves a deliberately over-long statement chunks rather than truncating.

**T3 — `financial_accounts`, `statements`, `statement_lines` + RLS.** §5.1.

**DONE 2026-09-18** — `0031_statements.sql`. Three tables, RLS enabled AND
forced on each (verified directly in `pg_class`: a forced policy binds the table
owner too, not just `app_rw`). Isolation proved by disabling RLS on
`statement_lines` and watching six tests fail — including a cross-tenant INSERT
actually succeeding and "fails closed with no tenant context" returning 3 rows
instead of 0 — then restoring.

*Three decisions worth carrying forward:*

**One signed `amount_signed`, not amount + direction.** The ticket said
"amount, direction". `transaction_splits.amount` is already signed, and a
second sign convention is a second set of rules to get wrong. Reused, not
reinvented.

**`balance_check` / `balance_residual` are declared and written by nothing** —
on purpose. T4 computes `pass`/`residual`; T5 writes `unverifiable` for a CSV
with no balance to check. §2 catalogues four columns that waited years for a
writer; these are deliberate placeholders with their writers named, which is a
different thing from an oversight.

**No jurisdiction in the DDL.** No country column, no date-order assumption, and
deliberately NO default currency — unlike `documents.currency`, which defaults
`'AUD'`. Per D-S1 both markets are in scope, and `statementRules` stays an
app-layer parameter.

*Wired to the dormant columns without wiring them:* `statements.document_id` is
document-backed, so a re-uploaded statement flags through the EXISTING
`documents.dedup_group_id` path rather than a second statement-shaped one —
"flag, never auto-merge" means one place to get it wrong, not two. And the
column is named `posted_date` so R5 can read it straight into
`transactions.settled_date` with no transformation.

*Left undone and flagged, not silently taken:* `goal_contributions.source_statement_line_id`
(0030) can now have its FK, since `statement_lines` exists. That belongs to
whoever owns that table, not to T3.
*Done when:* the RLS negative-case suite covers them the way the existing tables
are covered — **a test asserting another tenant is refused**, not that the owner
is allowed.

**T4 — The balance check as a first-class validator.** §4. *Done when:* a
statement with one row deliberately removed reports a non-zero residual and names
the row range where the running balance first disagrees. *This is the ticket that
makes the rest measurable.*

**DONE 2026-09-18.** `evaluateBalanceCheck()` is the single entry point — the
identity check and the running-balance gap check in one call, so no caller has
to compose the two primitives and get the composition wrong. A statement opening
1000.00 and printing 1375.00, with a +300.00 row deleted, reports
`balanceCheck: 'residual'` and `balanceResidual: '300.0000'` — **exactly the
missing row**, in BigInt, never floats. A residual computed in floating point
would be the bug this ticket exists to catch.

The gap names a RANGE, not a row: the break sits between the last agreeing
balance and the first that does not, rendered `"rows 2-3"`. A bare row number
sends somebody to the wrong line of a 200-row statement, and the numbering rides
on T5's existing `sourceRow` mapping rather than introducing a second count.

**`unverifiable` has no route to `pass`** — it returns from a different branch
entirely, and a test asserts that a CLEAN gap check on a balance-less statement
still lands `unverifiable`. That is the subtle case: finding nothing wrong is
not the same as proving nothing is wrong, and D-S3 binds us to the difference.
Verified by forcing `pass` and watching four tests fail across both the pure
functions and real Postgres.

*Two exports T2's PDF path should call once its rows are inserted:*
`evaluateBalanceCheck(...)` then `recordBalanceCheckVerdict(...)`. CSV writes the
verdict at INSERT time because it computes before the row exists; the recorder is
the complementary shape for a caller whose lines arrive after.

**T5 — CSV statement intake, and the verdict it is not allowed to claim.** §5.6.
Mode (c) is unbuilt end to end: `text/csv` is refused at
`apps/server/src/captures/captures.controller.ts:58-61` and again at `:251-254`,
`PageSource` has no member for a row dump
(`packages/api-contract/src/index.ts:45`), and no CSV parser is declared in any
`package.json`. *Do:* accept CSV as its own intake kind with a header-sniffed
column mapping the user confirms once per institution; normalise to the ledger's
debits-positive convention at intake while keeping the raw file as the immutable
original; and give `balance_check` an explicit `unverifiable` verdict. *Done
when:* three assertions hold — (1) a CSV carrying no opening or closing balance
imports with `balance_check = 'unverifiable'`, and a test asserts it **never**
records `pass`; (2) a CSV whose date column parses validly under both day-first
and month-first readings is resolved by the installed rule set's `dateOrder`
(`packages/tax-rules/src/contract.ts:348`) and the `PeriodSpec` tie-breaker
(`:365`) — **not** by a constant in the CSV reader — and is **refused** pending an
explicit user choice where those cannot settle it, proven by a test asserting the
refusal rather than a default; (3) a CSV whose
running-balance column is present and discontinuous between two adjacent rows
names the index of the first breaking row. Each is checkable by deleting the guard
and watching the test fail. *Depends on:* T3 and T4, whose tables and validator
this extends rather than duplicates.

**T6 — A handset can open a file at all.** §5.6's boxed finding: the native path
is camera-only (`apps/mobile/src/app/(tabs)/capture.tsx:203-206`), so on a phone
there is no route for a PDF, a file or a CSV today — only the browser build has a
picker. Three of the four decided intake modes have no client. *Do:* add a
document picker to the native path. Note this is **client work, not engine work**,
and it is unbudgeted by the rest of this plan. *Done when:* a statement PDF and a
CSV can both be selected from a handset and reach `POST /v1/captures`, driven on a
real device rather than the web build — the two are different code paths and the
web build passing proves nothing about the phone.

**T7 — The page and size caps admit a real statement.** `captures.controller.ts:79`
caps a capture at 20 declared pages, `:66` caps a page at 30 MB, and `:266`
requires a PDF to be the only page in its capture. *Do:* decide each deliberately
against the largest statement the product intends to accept. *Done when:* a
40-page statement PDF either imports or is **refused with a message naming the
cap**, and a test asserts which — silence at the boundary is the failure mode
here.

**DONE 2026-09-18, and the ticket was wrong about the defect.** The caps were not
merely too small: on the PDF path there was **no page cap at all**. A PDF must be
the only page in its capture, so `ArrayMaxSize` bounded the *declared* array —
always exactly one for a PDF — and never the physical page count, which only
`demuxPdf` reveals inside `upload()`. A 5,000-page PDF passed registration
unchecked and would have failed later, wherever the worker happened to exhaust
time or memory. That is precisely the "silence at the boundary" this ticket names,
and it was on the one axis nobody was looking at.

`MAX_CAPTURE_PAGES = 50` now bounds **both** the declared array and the post-demux
physical count, before any row reaches `capture_pages`. 40 pages comes from §5.6's
stated target; the extra 10 is a margin and is labelled in the code as a judgement
call, because nothing here measures a real institution's longest statement.
Verified by breaking both guards and watching the tests fail (`expected 400, got
200`; `expected 400, got 201`).

*The byte cap was deliberately NOT raised.* `apps/server/src/main.ts` sets the
Fastify `bodyLimit` to 32 MB, so a single upload physically cannot exceed it.
Raising the DTO past ~30 MB would advertise a ceiling the transport refuses to
honour. **If a statement ever needs to exceed ~30 MB, `main.ts` must change too.**

*Unsized follow-up:* the worker can now be handed 2.5× the pages it was ever asked
for. T2's chunking helps, but wall-clock timeouts, memory ceilings and per-page
model billing at 50 pages are not addressed by this ticket.

### Lane R — Reconcile

Design: §5.3.1. Order: `R5a` → `R5b` → {`R5c`, `R5d`, `R5e`, `R5f-1` → `R5f-2`}
→ `R5g` → `R5h`; `R6`–`R9` stand on `R5b`. Every suite named below runs as the
real application roles (`snap_app` / `snap_worker`), never the admin connection
— `rls.test.ts`'s header says why — and every guard is proven by breaking it
once and watching the named test fail.

**R5 — `event_observations` and the merge rule.** §5.3. *Done when:* a receipt
and its statement line produce **one** posted transaction whose `txn_date` comes
from the receipt, whose `settled_date` comes from the statement, and whose splits
come from the receipt's lines — with both documents retained and linked.
*Re-cut 2026-09-18* into `R5a`–`R5h` below; the umbrella closes when `R5h` does.

**R5a — Schema: the observation register, the candidate ledger, and the enum
member 0030 left out.** Migration `0032` per §5.3.1's DDL sketch: the three
enums, `ALTER TYPE contribution_source ADD VALUE 'statement_line'` (referenced
nowhere else in the file — `0023`'s rule), `match_candidates`,
`event_observations`, the two deferred constraint triggers, the backfill with
its count self-check, the two matcher indexes, RLS in the 0031 loop with its
`pg_class` self-check, Drizzle mirrors in `enums.ts` / `tables.ts`, and both
tables (plus the three 0031 tables) added to `test-support/tenant.ts`'s wipe
list and `rls.test.ts`'s. *Done when:* (1) `drift.test.ts` is green with both
tables declared; (2) `rls.test.ts` carries a **cross-tenant refusal** for each —
tenant B's INSERT into A's rows rejected, a no-context SELECT returning 0 — and
disabling RLS on one table makes those cases fail (0031's method); (3) a test
voids a transaction that still carries an observation and asserts COMMIT is
refused, and the same with the link re-pointed first commits; (4) a test gives
a non-void transaction a `document_id` its document observation disagrees with
and asserts COMMIT is refused; (5) against a database holding one posted
document-backed transaction, the migration leaves exactly one observation row
with `confirmed_by = posted_by`, and a seeded disagreement makes the migration
fail and leave nothing behind.

**R5b — The merge rule as a pure function, and supersede-never-edit.**
`apps/server/src/transactions/`. Extract the split-building half of
`draftTransactionFromDocument` into `mergeObservations(evidence, rules)` with
the rules in §5.3.1's table; add `supersedeAndPost` (void every live
transaction materialising the evidence, insert the merged one, re-point and
insert observation rows, post — one `withTenantAs`); extract the posting
UPDATE into a helper `postTransaction` also calls, so its "one and only place"
comment stays true; make the existing draft path insert its `kind =
'document'` observation. Tax codes by `tenants.country`. Refusals as values.
*Done when:* (1) `transactions.test.ts` and `transactions.sale.test.ts` pass
unchanged; (2) the same evidence set merged twice yields identical split
arrays — accounts, amounts, tax codes, `gst_amount`, order; (3) the umbrella's
*done when* as an end-to-end test against real Postgres: a receipt issued
12 Aug for 84.20 across two tax treatments plus a line posted 14 Aug for
−84.20 ⇒ exactly one non-void transaction, `txn_date = 2026-08-12`,
`settled_date = 2026-08-14`, `source = 'scan'`, splits = the receipt's
subtotals and control legs plus one −84.20 leg into the financial account's
`account_id`, two observation rows on it, `transactions.document_id` = the
receipt; (4) each refusal has a test — `amount_disagreement` without a
`variance_kind`, `currency_mismatch`, `document_not_confirmed` — and a −89.20
line accepted with `variance_kind = 'tip'` adds exactly one +5.00 split to
`6-9200` under `N-T`; (5) an `id-2026` tenant posting a standard-rated document
gets the ID `PPN` code and 0026's trigger does **not** fire — write this test
first and watch it fail today; (6) a receipt with no `issue_date` and a line
takes `txn_date = value_date ?? posted_date`, never today's date; (7) after a
supersede the old row is `'void'`, `void_reason` begins `superseded:`,
`external_refs.superseded_by` names the new id, and no observation points at
it.

**R5c — Candidates, and accept / reject / unlink / manual link.** New module
`apps/server/src/reconciliation/` (`matcher.ts`, `reconciliation.repo.ts`,
`reconciliation.controller.ts`), wire types in `packages/api-contract`
(`MatchCandidateView`, `MatchEvidence`, `EventObservationView`,
`StatementLineView`; `TransactionRow` gains `settledDate`, `observations`,
`supersededBy`; `DocumentView` gains `settlement`). Endpoints:
`GET /v1/reconciliation/candidates?statementId|documentId&status`,
`POST …/candidates/:id/accept {variance?:{kind}}`, `POST …/candidates/:id/reject`,
`POST /v1/reconciliation/matches {statementLineId, documentId, variance?}`,
`POST /v1/reconciliation/observations/:id/unlink`. Accept, manual link and
unlink carry `TransactionsController#post`'s owner/admin check; reject is any
non-readonly member. The matcher follows §5.3.1 Q3 exactly — facts, ranking,
no threshold — and `packages/tax-rules/src/interpreter.ts` gains
`withinPostingLag(rules, issued, posted)`, the first reader of S4's field.
*Done when:* (1) four 12.50 lines on two cards against one 12.50 receipt with
`card_last4 = 4417`: the two lines on 9021 are **not** candidates, the two on
4417 are, ranked by `|date_gap_days|`; (2) a tenant with no rule set receives
candidates with `within_posting_lag: null` — asserted, not skipped — and an
`id-2026` tenant receives `true` / `false`; (3) running the matcher twice adds
no row for any pair, and a rejected pair is never re-suggested; (4) accept runs
R5b's supersede and returns the new `transactionId`; accepting against a
`needs_review` document is a 409 `document_not_confirmed`; (5) two concurrent
accepts of two candidates for one line, against real Postgres: exactly one
succeeds and the other surfaces `event_observations_line_once` as a 409, not
a 500; (6) unlink passes §5.3.1 Q5's test; (7) **the personal refusal**: a
personal fixture driven through every endpoint here yields JSON matching
neither `/gst/i` nor `/ppn/i`, and the same assertion run against
`GET /v1/documents/:id` on a `business` fixture with `gstAtRisk` set fails —
so the matcher is shown to bite; (8) tenant B can neither list nor accept
tenant A's candidate — 404, and no row changes.

**R5d — A statement line stands alone.** `POST /v1/statement-lines/:id/post`
and `POST /v1/statements/:id/post-unmatched` (bulk), owner/admin: the merge
with no document — `source = 'import'`, an uncategorised debit or credit split
plus the account leg, `txn_date = value_date ?? posted_date`, `settled_date =
posted_date`, one `statement_line` observation. *Done when:* (1) a −84.20 line
posts as `Uncategorised Purchases +84.20 / account −84.20`, a +2,500.00 line
as `account +2,500.00 / Uncategorised Receipts −2,500.00`; (2) bulk over a
300-line statement posts every unmatched line and skips every line with a live
observation, asserted by count; (3) a later accept for one of those lines
supersedes its standalone transaction, and the statement-first and
receipt-first orders end split-for-split equal (§5.3.1 Q4); (4) `PersonalSummary`
is **unchanged** by this ticket — it still derives from documents until M9 —
asserted, so that change stays a decision (§14.2 item 5) rather than a side
effect.

**R5e — `dedup_group_id` gets its writer.** The fingerprints in §5.3.1, written
in `saveExtraction` and the statement writers; one `review_tasks` row, `reason =
'possible_duplicate'`, when a group reaches two; never auto-merge, never
auto-reject. *Done when:* (1) one docket photographed twice — different bytes,
same supplier, date and total — yields two documents sharing one
`dedup_group_id` and exactly one task naming both; (2) a receipt missing any
fingerprint part gets NULL and no task; (3) an identical CSV re-imported never
reaches this path — `captures_sha_unique` fires first, asserted — while a
re-exported statement for the same account and period with different bytes is
grouped; (4) resolving the task through the existing reject flow leaves both
`documents` rows present with `deleted_at` NULL — a refusal-to-delete test.

**R5f-1 — Grounded goal contributions: the constraints.** Migration `0033` per
§5.3.1: drop `goal_contributions_no_statement_line_yet`; add the
`(source = 'statement_line') = (source_statement_line_id IS NOT NULL)` CHECK,
the FK `ON DELETE RESTRICT`, the index, and the grounding constraint trigger
(line is money in; grounded contributions never sum past it). *Done when:*
(1) `source = 'statement_line'` with a NULL pointer, and `'manual'` with one,
are both refused; (2) a contribution grounded in a debit line is refused;
(3) of two contributions that together exceed the line, the second is refused
and the first stands; (4) deleting a statement line a contribution names is
refused — asserted, because the cascade from `statements` would otherwise take
it silently; (5) `drift.test.ts` is green after `enums.ts` gains the member.

**R5f-2 — Grounded goal contributions: the write path.**
`POST /v1/business/goals/:id/contributions` accepts `{statementLineId, amount?}`;
the server derives `amount` (default the whole line), `occurred_on =
posted_date`, `source = 'statement_line'`; `GoalContributionRow.source` widens
and the listing carries the line's `description_raw` as provenance. *Done
when:* (1) a +500.00 savings credit grounds a 500.00 contribution dated the
line's `posted_date`, and `goals.saved` follows through 0030's trigger; (2) an
`amount` above the line's is a 422 naming the line's amount; (3) an
`occurredOn` in the body is ignored for a grounded contribution — asserted;
(4) the goal screen shows the provenance in personal language (*"from your
statement, 14 Aug"*), with the copy test from R5c run on it.

**R5g — Both sides on screen.** The reconciliation surface on mobile: unmatched
lines per statement; candidates as two-column cards with `evidence` rendered as
sentences (*"same card ending 4417 · cleared two days later"*); accept, reject,
manual link, unlink; and `settlement` on the document screen (*"Cleared 14 Aug
via Visa ···4417"*). §10.5 is the brief — suggestion with a stated reason,
one-tap reject — and `docs/DESIGN-HANDOFF.md` §3 and §12 bind. *Done when:*
(1) driven against the real server on a device or the web build: accept a
candidate, then see one transaction in the ledger list carrying both
observations; (2) `settlement` renders only when non-null and never a tax
word in personal, checked at the rendered layer with R5c's fixture;
(3) reject removes the card and the pair does not return on refresh;
(4) unlink is reachable from the transaction and returns the line to the
unmatched list; (5) every figure on screen is a server field — no client-side
arithmetic.

**R5h — QA gate for the register.** Run R5a–R5g's suites as the application
roles; drive receipt-first and statement-first end to end over HTTP; break each
guard once — RLS off on one new table, a deferred trigger dropped, the country
filter on tax codes removed, `amount_exact` relaxed to a tolerance — and record
which test failed for each; confirm no numeric threshold exists in
`reconciliation/matcher.ts` beyond exact equality, and that
`LOW_CONFIDENCE_THRESHOLD` is not referenced there. *Done when:* the
break-and-watch table is in the ticket report with a named failing test for
every guard, and no guard is without one.

**R6 — Transfers and credit-card payments.** §6, on the register: `match_candidates`
gains `counterpart_line_id`, `document_id` becomes nullable and a CHECK requires
exactly one counterpart; the matcher proposes opposite-signed equal-amount
pairs across two of the tenant's `financial_accounts` — facts and ranking, the
same no-threshold rule as R5c; the merge's two-line case is two account legs
and no expense or income split. Decide here what becomes of the brand-derived
`2-11xx` suspense liabilities (§5.3.1, *found while designing*). *Depends on:*
R5b, R5c. *Done when:* a transfer between two owned accounts appears in neither
spending nor income, and a card payment does not double-count the purchases on
that card — both tested as refusals — and a test asserts the two-line event has
**no split on any expense or income account**, not merely a right total.

**R7 — The match key and its threshold.** §5.4. The labels are R5's
`match_candidates` rows — `status`, `evidence`, `decided_at`. A `score` may be
added to candidates, never to `event_observations`; an auto-accepted link
writes a distinct `status` (`'auto_accepted'`, added by this ticket) with
`decided_by` NULL, so a machine link can never be mistaken for a human one.
*Depends on:* R5c, and enough labels — a count this ticket must state, not
assume. *Done when:* the false-match rate is **stated as a number on held-out
confirmations**, not chosen, with held-out meaning *by `decided_at`* rather than
a random split so a re-decided pair cannot leak; no match auto-confirms below
it; and `LOW_CONFIDENCE_THRESHOLD`'s placeholder is not repeated.

**R8 — The three unmatched states surfaced, in the language the workspace
permits.** Missing-from-bank, missing-substantiation, amount-disagreement.
*Do:* give each a screen and a test. Missing-substantiation names the GST/PPN
amount at risk **in a business workspace only**; in a personal workspace the same
row surfaces as *"no receipt for this payment"* with no tax figure, because
`AnalyticsSummary` is contractually null there
(`packages/api-contract/src/index.ts:597`) and
`packages/tax-rules/src/verify.ts:341-347` refuses a personal filing period for
the tax. Amount-disagreement is R5b's `variance_kind` made visible: a manual
link whose amounts differ asks the person to **name** the difference; the
screen never proposes a kind. The age after which a line counts as
missing-substantiation is a display parameter and a judgement call — §5.3
says 60 days and nothing has measured that. *Depends on:* R5c, R5g. *Done
when:* each of the three states has a screen and a test; the business flag
names the amount at risk; and a test drives the personal workspace through the
same unmatched row and asserts the rendered output contains **no GST or PPN
figure** — a refusal, in the style of `registry.test.ts:50`, not a happy path.

**R9 — E1, folded in (D-S4).** One per-line split, two surfaces. §7.3. The
split-of-record is the **ledger split**: R5b's `mergeObservations` groups the
receipt's lines by tax treatment today; R9 changes the grouping key to
(`category_id`, tax treatment) and writes `transaction_splits.category_id` and
`document_line_id`, so one row is read as a spending category in personal and a
tax subtotal in business. *Do:* write `document_lines.category_id`
(`packages/db/src/schema/tables.ts:391`) and `document_tax_subtotals` (`:395`)
from the same extraction pass, and read them twice — as **spending categories**
in `PersonalSummary` and the reconciliation review screen (retiring the constant
`'Uncategorised'` at `documents.controller.ts:266`), and as **tax subtotals** in
the business review UI and BAS pack, which stay dark until D34 reverses. Close
the two gaps in §7.3: gate the existing *"Split by tax treatment"* block
(`apps/mobile/src/app/document/[id].tsx`) on workspace kind, and give
`BasSummary` the workspace test the analytics path already has at
`summaries.controller.ts:169`. *Depends on:* R5b. *Done when:* (a) a supermarket
docket matched to one bank row splits that row across more than one **spending**
category in a personal workspace, proven on the split totals; (b) **a test
asserts the refusal** — for a personal workspace every summary and document
payload the client can reach carries `gstClaimable === null`, `gstAtRisk ===
null` and no rendered GST or PPN figure, verified by flipping the fixture to
`business` and watching the same test fail; (c) the market-scan claim in
`docs/GAPS.md:451` appears in no personal-facing copy while D34 stands.

### Lane M — Money in, and getting smarter

**M9 — Income, transfers and refunds in the personal and analytics summaries.**
§3.2, §6. *Done when:* `PersonalSummary` carries income and net position, and a
refund reduces its original category rather than adding income.

**M10 — Mine `document_field_corrections` into per-tenant categorisation rules.**
§5.5. *Done when:* a merchant categorised three times is categorised
automatically the fourth, the app can state the rule and the count that did it,
and a test proves the rule never overrides a human-locked field —
`documents.locked_fields` already exists for exactly that and its rule is that a
re-extraction must not overwrite it.

**M11 — Re-run the C1 grounding experiment on statements.** §9.2. *Done when:*
the balance-residual rate is recorded for free-reading and pointing on the same
statements, and C1 is either adopted for this document class or **closed as
measured**, with the prediction in §9.2 checked against the result either way.

---

## 13. What this plan deliberately does not do

- **It does not build a bank feed.** Decided, not deferred (D-S3). Open banking
  — CDR in Australia; aggregators such as Brick or Brankas in Indonesia — is a
  different product with different economics, licensing and consent law. Worth
  noting what that costs: in Australia a feed would be strictly better than a PDF
  on every axis except evidence retention, so this decision accepts a weaker
  intake in the market where a stronger one exists. The four modes in §5.6 are
  the whole of it.
- **It does not write per-bank parsers.** §10.2.
- **It does not claim any accuracy number.** `docs/CORPUS.md` §4's controls bind
  every measurement above, and the tier floor refuses a headline below Tier R.
- **It does not touch B1.** §11.

---

## 14. Decisions, and what is still open

### 14.1 Settled by the owner, 2026-09-17

Four questions were put and answered. They are recorded here as decisions
because they were made, not because this document recommends them — the
consequences below are what follows from each, including the costs.

**D-S1 — Both markets: Australia and Indonesia.**
*Consequence:* `docs/INDONESIA.md` §11's option **B** — evidence plus
parameterisation — becomes the floor rather than one of four choices. Statement
handling is a jurisdiction parameter from the first commit, not a second set of
constants in a different file. The PPN divisor defect (§7) is now a prerequisite,
not a related ticket. §7.4 works through what a rule set has to carry.
*Cost:* every statement ticket carries a parameterisation tail, and `S2`/`S3`
move ahead of Lane T.

**D-S2 — Personal workspace first.**
*Consequence:* D34 stands; business surfaces stay dark. Money in, net position,
transfers and refunds are the shipped value; reconciliation still gets built
because the personal case needs it just as much, but substantiation flags and
cash-basis GST wait.
*Cost, stated plainly:* the personal workspace never shows GST — that is an
enforced property, not a styling choice (§7.3) — so **the half of `E1` that is a
tax claim does not ship under this decision**. The market-scan line about
per-category tax subtotals is a business claim and stays unshipped. §7.3 sets out
what the same mechanism does buy in personal, which is real but is a different
sentence.

**D-S3 — Four intake modes: uploaded PDF, uploaded file, CSV, and scanned with
our own camera. No bank feed.**
*Consequence:* §13's "does not build a bank feed" is now a decision rather than a
deferral, and CSV joins the intake surface. §5.6 works through the four modes.
*Cost:* CSV is the cheapest mode and the one §4's self-verification covers least
well — a row dump with no opening or closing balance cannot prove it is complete.
That is the sharpest single consequence of this decision and §5.6 does not soften
it.

**D-S4 — `GAPS.md` E1 folds into Lane R rather than shipping before or after.**
*Consequence:* the per-line split is built once and surfaced twice — as spending
categories in personal now, as tax subtotals in business when D34 reverses. It
stops competing with this work for the same weeks.
*Cost:* `ROADMAP.md` §6 calls E1 the highest-value buildable thing precisely
because it is small and standalone. Folding it into a larger lane means it lands
later than it would have alone, and its business half lands later still (D-S2).

### 14.1b Settled by the owner, 2026-09-18

**D-S5 — The borrowed Ollama Cloud key stays the production extraction
provider, for now.**
*Asked because it contradicts a standing rule.* The owner's global working
rules describe that provider as *"borrowed + SHARED + weekly-rate-limited (NOT
a prepaid token balance). Fine for dev/testing; do NOT make it a hard prod
dependency."* As of 2026-09-18 it IS a hard production dependency: every
extraction runs through it, and the app produces no documents without it.
*Decision:* accepted, explicitly and for now.
*Cost, stated plainly:* the weekly cap is shared with other projects and is not
ours to control. When it is reached, extraction stops for everybody — captures
will queue at `received` exactly as they did during the 2026-09-16 outage, and
the app will look broken in the same way. There is no second provider
configured to fall back to. This is a known, accepted, temporary exposure and
not a thing anyone has measured the headroom of.

### 14.2 Still open

Three questions survive the decisions above, and the answers still change the
work.

1. **Is the buyer the practice or the user?** `docs/MONETISATION.md` says the
   practice channel is the one that works, and reconciliation is bookkeeper work.
   D-S2 points the first release at the consumer. Those are different products
   and the tension is not resolved by picking a workspace — it is deferred by it.
2. **What does "categorise it well" mean to the client?** Tax categories
   (deduction codes, BAS/PPN labels) and spending categories (groceries, fuel)
   are different taxonomies. `categories` carries both today — `engine_row_id`
   and `ato_deduction_code` alongside a user-facing name. D-S2 makes the second
   one the visible taxonomy; whether the client agrees is unconfirmed.
3. **How much manual correction is acceptable in month one?** Layer 1 of §5.5
   only gets good with use, so the feature is at its worst on the first
   statement — which is also the only one a trialling user will see. The
   onboarding has to survive that, and no amount of engine accuracy fixes it.

Two more were raised by the R5 design pass of 2026-09-18 (§5.3.1). Both carry a
recommendation there; neither is decided.

4. **Is accepting a match the same act as posting?** §5.3.1 proposes one act —
   accept posts the merged transaction, under the owner/admin rule posting
   already has — because the receipt was confirmed separately beforehand and
   the bank line is cleared money. The alternative is two taps, accept then
   post, which 0009's *"two separate acts"* could be read to require. The
   answer changes `R5c`'s endpoint semantics and `R5g`'s screen.
5. **Do statement lines count as spending before a person posts them?**
   §5.3.1 keeps the machine out of the ledger: a line becomes a transaction only
   through a human act — accept, or `R5d`'s post-as-spending, single or bulk.
   If the personal tracker should show statement spending the moment a
   statement is read, either `M9` reads `statement_lines` directly and
   subtracts the matched ones (the register is what makes that subtraction
   possible), or `R5d` posts automatically, which is the machine moving the
   books. `R5d` asserts `PersonalSummary` is unchanged precisely so this stays
   a choice.

---

## 15. What was verified, and what is estimated

**Verified by reading the repository at `6f0b76b`:** every file path, every
schema column, the four unused columns and two unused enum members in §2, the
divergence between `extraction-schema.json` and `types.ts`, PDF text-layer
classification, byte-level dedup, `pg_trgm` enabled and unused, `PersonalSummary`
having no income, and the truncation handling in `run.ts`. Added on the second
pass: the MIME gates and page/size caps in `captures.controller.ts`, the
camera-only native path in `capture.tsx`, the absence of any CSV parser, the
`BUSINESS_FEATURES_ENABLED` redirects, the four tax-rules refusals and the tests
that fire them, the full shape of `contract.ts`, and both `gstFromInclusive`
implementations.

**Two things this document corrects in other documents.** `docs/INDONESIA.md` §8
says `tenants.country` is *"a stored fact with no behaviour attached"* — that was
true on `feat/web-3d-spike` and is **not true here**: `apps/server/src/taxrules/`
reads and acts on it (§7.4). And §8's inventory implies the parameterisation is
largely unbuilt, where `contract.ts` in fact already expresses eight of the ten
parameters statements need. Neither correction was sought; both turned up while
checking the inventory row by row rather than citing it.

**Taken from the project's own documents, not independently checked:** the market
scan of 12 September 2026, the B2 and C1 benchmark results, the Indonesian tax
positions in `docs/INDONESIA.md` (which carries its own sources and its own §10
list of weak ones) — including the PPN rates and the DPP Nilai Lain identity
break that §7.4 and ticket `S3` rest on.

**Estimated, and marked as such where it appears:** that statement PDFs are
predominantly text-layer (§9.1); that long-table extraction fabricates more than
short-receipt extraction (§9.2, stated as a prediction to be checked, not a
finding); that posting lag is typically 0–3 days (varies by institution and
product, and should be a rule-set parameter rather than a constant).

**Not measured at all:** anything about accuracy on statements. There is no
statement corpus. §4 is an argument that one can grade itself — it is not a
result, and nothing in this document should be quoted as one.
