import { randomUUID } from 'node:crypto';

import { money, withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import type {
  MatchCandidateStatus,
  MatchCandidateView,
  MatchEvidence,
  MatchVarianceKind,
} from '@snap/api-contract';

import { getDb } from '../db.js';
import { readTenant } from '../repo.js';
import { rulesFor } from '../taxrules/taxrules.repo.js';
import { supersedeAndPost, type SupersedeOutcome } from '../transactions/transactions.repo.js';
import { evaluateCandidate, evaluateManualLinkFacts, rankCandidates, type CandidatePairInput } from './matcher.js';

/**
 * `docs/STATEMENTS.md` §5.3.1 / §12 R5c — candidate generation, and
 * accept / reject / unlink / manual link.
 *
 * `event_observations` is facts (migration 0032): a row exists iff a human
 * (or the posting act itself) has established that this evidence observes
 * this event. `match_candidates` is hypotheses and their outcomes. This file
 * never edits a transaction in place — every state change that touches the
 * ledger goes through `transactions.repo.ts`'s `supersedeAndPost`
 * (R5b), never reimplemented here.
 *
 * D-S6 (§14.1c): accepting a match IS the act of posting it — `acceptCandidate`
 * and `manualLink` both end at a POSTED transaction, not a draft a second call
 * must confirm.
 */

/** Stamped into `match_candidates.matcher_version` — opaque, never parsed
 *  back, bumped only if this file's OUTPUT for the same evidence would
 *  change. Mirrors `transactions.repo.ts`'s `MERGE_RULE_VERSION`. */
const MATCHER_VERSION = 'r5c.2026-09-18';

/* ── Candidate generation + listing ───────────────────────────────────────── */

export interface ListCandidatesParams {
  statementId?: string;
  documentId?: string;
  status?: MatchCandidateStatus;
}

export type ListCandidatesOutcome =
  | { ok: true; candidates: MatchCandidateView[] }
  | { ok: false; reason: 'missing_statement' }
  | { ok: false; reason: 'missing_document' };

type RawPairRow = {
  line_id: string;
  line_posted_date: string;
  line_card_last4: string | null;
  document_id: string;
  document_issue_date: string | null;
  document_card_last4: string | null;
  merchant_similarity: number;
};

type HydratedRow = {
  id: string;
  statement_line_id: string;
  document_id: string;
  status: string;
  proposed_by: string;
  evidence: MatchEvidence;
  variance_kind: MatchVarianceKind | null;
  variance_amount: string | null;
  decided_at: string | null;
  line_posted_date: string;
  line_amount_signed: string;
  line_description_raw: string;
  account_label: string;
  supplier_name: string | null;
  document_issue_date: string | null;
  document_payable_amount: string;
  document_card_last4: string | null;
};

function toMatchCandidateView(row: HydratedRow): MatchCandidateView {
  return {
    id: row.id,
    statementLineId: row.statement_line_id,
    documentId: row.document_id,
    status: row.status as MatchCandidateStatus,
    proposedBy: row.proposed_by as MatchCandidateView['proposedBy'],
    evidence: row.evidence,
    variance:
      row.variance_kind && row.variance_amount
        ? { kind: row.variance_kind, amount: row.variance_amount }
        : null,
    decidedAt: row.decided_at,
    statementLine: {
      postedDate: row.line_posted_date,
      amountSigned: row.line_amount_signed,
      descriptionRaw: row.line_description_raw,
      accountLabel: row.account_label,
    },
    document: {
      supplierName: row.supplier_name,
      issueDate: row.document_issue_date,
      payableAmount: row.document_payable_amount,
      cardLast4: row.document_card_last4,
    },
  };
}

/**
 * Runs the matcher for a statement or a document — whichever the caller is
 * looking at — then reads back its candidates. "The matcher... runs on
 * read" (§5.3.1 Q3): there is no background job and no queue; a `GET` is
 * what computes what is missing, idempotently, before returning.
 *
 * Exactly one of `statementId`/`documentId` is the caller's contract
 * (`reconciliation.controller.ts` enforces it before this is ever called).
 */
export async function listCandidates(
  userId: string,
  tenantId: string,
  params: ListCandidatesParams,
): Promise<ListCandidatesOutcome> {
  const tenant = await readTenant(userId, tenantId);
  // Same convention as `transactions.repo.ts`: `tax_rules_id` null means no
  // engine installed (every Australian tenant, today) — `rulesFor` would
  // throw, so it is simply never called. `rules: null` is what makes
  // `within_posting_lag: null` real rather than a caught exception.
  const rules = tenant?.tax_rules_id ? await rulesFor(tenant) : null;

  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    if (params.statementId) {
      const rows = await t.execute<{ id: string }>(sql`
        select id from statements where id = ${params.statementId}
      `);
      if (!rows.rows[0]) return { ok: false, reason: 'missing_statement' };
    }
    if (params.documentId) {
      const rows = await t.execute<{ id: string }>(sql`
        select id from documents where id = ${params.documentId} and deleted_at is null
      `);
      if (!rows.rows[0]) return { ok: false, reason: 'missing_document' };
    }

    // 1. The SQL-level pre-filter: same tenant (RLS), same currency, EXACT
    //    amount (sign per doc_type), neither side already MATCHED. Backed by
    //    the two indexes migration 0032 added for exactly this. Everything
    //    past here is `matcher.ts`'s job.
    //
    //    "Matched" is BOTH-SIDED, not "has any observation at all" — a
    //    document posted standalone (receipt-first, §5.3.1 Q4: "Confirm ->
    //    draft -> post: a receipt-only transaction") already carries a
    //    'document' observation the moment it posts, via
    //    `draftTransactionFromDocument`, and R5d's standalone line-post gives
    //    a line its own 'statement_line' observation the same way — NEITHER
    //    is "matched" yet in the sense this filter means: nobody has linked
    //    receipt to bank line. That only becomes true once ONE transaction
    //    carries observations of BOTH kinds, which is exactly what
    //    `event_observations_one_document_per_event`'s partner check below
    //    tests for. Get this filter wrong the other way — "any observation
    //    excludes" — and the receipt-first flow (post the document, THEN
    //    have the statement land) could never generate a candidate for its
    //    own document again, which is the design's own primary scenario.
    const pairs = await t.execute<RawPairRow>(sql`
      with open_lines as (
        select sl.id, sl.amount_signed, sl.posted_date::text as posted_date,
               sl.card_last4, sl.description_normalised, fa.currency::text as currency
          from statement_lines sl
          join statements st on st.id = sl.statement_id
          join financial_accounts fa on fa.id = st.financial_account_id
         where sl.tenant_id = ${tenantId}
           and (${params.statementId ?? null}::uuid is null or st.id = ${params.statementId ?? null}::uuid)
           and not exists (
             select 1 from event_observations eo_line
               join event_observations eo_doc
                 on eo_doc.transaction_id = eo_line.transaction_id and eo_doc.kind = 'document'
              where eo_line.statement_line_id = sl.id and eo_line.kind = 'statement_line'
           )
      ),
      open_docs as (
        select d.id, d.payable_amount, d.doc_type::text as doc_type, d.currency::text as currency,
               d.issue_date::text as issue_date, d.card_last4, p.name_normalised
          from documents d
          left join parties p on p.id = d.supplier_id
         where d.tenant_id = ${tenantId} and d.deleted_at is null and d.doc_type <> 'statement'
           and d.payable_amount is not null
           and (${params.documentId ?? null}::uuid is null or d.id = ${params.documentId ?? null}::uuid)
           and not exists (
             select 1 from event_observations eo_doc
               join event_observations eo_line
                 on eo_line.transaction_id = eo_doc.transaction_id and eo_line.kind = 'statement_line'
              where eo_doc.document_id = d.id and eo_doc.kind = 'document'
           )
      )
      select ol.id as line_id, ol.posted_date as line_posted_date, ol.card_last4 as line_card_last4,
             od.id as document_id, od.issue_date as document_issue_date, od.card_last4 as document_card_last4,
             coalesce(similarity(ol.description_normalised, od.name_normalised), 0)::float8 as merchant_similarity
        from open_lines ol
        join open_docs od
          on od.currency = ol.currency
         and (
           (od.doc_type <> 'credit_note' and od.payable_amount = -ol.amount_signed)
           or (od.doc_type = 'credit_note' and od.payable_amount = ol.amount_signed)
         )
    `);

    // 2. Pure evaluation — excludes card mismatches, computes facts. No
    //    threshold anywhere in `evaluateCandidate` (`matcher.ts`).
    const evaluated = pairs.rows
      .map((r): CandidatePairInput => ({
        lineId: r.line_id,
        documentId: r.document_id,
        linePostedDate: r.line_posted_date,
        lineCardLast4: r.line_card_last4,
        documentIssueDate: r.document_issue_date,
        documentCardLast4: r.document_card_last4,
        merchantSimilarity: r.merchant_similarity,
      }))
      .map((input) => evaluateCandidate(input, rules))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // 3. Idempotent insert. `ON CONFLICT DO NOTHING` on `match_candidates`'s
    //    `(statement_line_id, document_id)` unique pair is what makes running
    //    this twice a no-op, and what makes a rejected pair NEVER
    //    re-suggested — a row for that pair already exists, so the conflict
    //    fires regardless of its status.
    for (const c of evaluated) {
      await t.execute(sql`
        insert into match_candidates (
          id, tenant_id, statement_line_id, document_id, status, proposed_by, matcher_version, evidence
        ) values (
          ${randomUUID()}, ${tenantId}, ${c.lineId}, ${c.documentId}, 'suggested', 'matcher',
          ${MATCHER_VERSION}, ${JSON.stringify(c.evidence)}::jsonb
        )
        on conflict (statement_line_id, document_id) do nothing
      `);
    }

    // 4. Read back and hydrate for display. `status` narrows when given;
    //    omitted, every status is returned (the caller's own choice of view).
    const rows = await t.execute<HydratedRow>(sql`
      select mc.id, mc.statement_line_id, mc.document_id, mc.status::text as status,
             mc.proposed_by::text as proposed_by, mc.evidence,
             mc.variance_kind, mc.variance_amount::text as variance_amount,
             to_json(mc.decided_at)#>>'{}' as decided_at,
             sl.posted_date::text as line_posted_date, sl.amount_signed::text as line_amount_signed,
             sl.description_raw as line_description_raw,
             coalesce(fa.display_name, fa.institution) as account_label,
             p.legal_name as supplier_name, d.issue_date::text as document_issue_date,
             d.payable_amount::text as document_payable_amount, d.card_last4 as document_card_last4
        from match_candidates mc
        join statement_lines sl on sl.id = mc.statement_line_id
        join statements st2 on st2.id = sl.statement_id
        join financial_accounts fa on fa.id = st2.financial_account_id
        join documents d on d.id = mc.document_id
        left join parties p on p.id = d.supplier_id
       where mc.tenant_id = ${tenantId}
         and (${params.statementId ?? null}::uuid is null or st2.id = ${params.statementId ?? null}::uuid)
         and (${params.documentId ?? null}::uuid is null or mc.document_id = ${params.documentId ?? null}::uuid)
         and (${params.status ?? null}::text is null or mc.status = (${params.status ?? null}::text)::match_candidate_status)
    `);

    const candidates = rankCandidates(rows.rows.map(toMatchCandidateView));
    return { ok: true, candidates };
  });
}

/* ── Accept / manual link (shared finish) / reject / unlink ──────────────── */

export type DecideOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing_candidate' }
  | { ok: false; reason: 'already_decided'; status: string }
  | (SupersedeOutcome & { ok: false });

interface CandidateRef {
  id: string;
  documentId: string;
  statementLineId: string;
}

/** The document's `payable_amount` and the line's `amount_signed`, for
 *  recording a variance amount on `match_candidates` at decision time —
 *  RECORDED only, per §5.3.1's own words: "the matcher never supplies a
 *  variance." This mirrors `mergeObservations`' own residual
 *  (`expected - debitTotal`) using the document's own reconciled payable
 *  amount as `debitTotal`'s stand-in, which R5b's `linesGap` check already
 *  guarantees agrees with the receipt's own subtotals for every document
 *  that could reach this function's caller (`document_not_confirmed`,
 *  `ambiguous_tax_categories` and `lines_dont_reconcile` all refuse earlier,
 *  inside `supersedeAndPost` itself). */
async function computeVarianceAmount(
  userId: string,
  tenantId: string,
  ref: CandidateRef,
): Promise<string | null> {
  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ payable_amount: string | null; amount_signed: string }>(sql`
      select d.payable_amount::text as payable_amount, sl.amount_signed::text as amount_signed
        from documents d, statement_lines sl
       where d.id = ${ref.documentId} and sl.id = ${ref.statementLineId}
    `);
    const row = rows.rows[0];
    if (!row?.payable_amount) return null;
    const residual = money.subtract(money.negate(money.money(row.amount_signed)), money.money(row.payable_amount));
    return residual;
  });
}

/**
 * The shared finish for both `acceptCandidate` and `manualLink`: run R5b's
 * `supersedeAndPost` (never reimplemented here — void-and-repost is entirely
 * its job), and only on success flip the `match_candidates` row to
 * `'accepted'`. Ordering matters: the candidate is decided ONLY once the
 * merge has actually posted, so a refused merge (e.g. `document_not_confirmed`)
 * leaves the candidate exactly as it was — still `'suggested'` — for another
 * attempt.
 */
async function supersedeAndDecide(
  userId: string,
  tenantId: string,
  ref: CandidateRef,
  variance?: { kind: MatchVarianceKind },
): Promise<DecideOutcome> {
  const outcome = await supersedeAndPost(userId, tenantId, {
    documentId: ref.documentId,
    statementLineId: ref.statementLineId,
    variance,
    candidateIds: [ref.id],
  });
  if (!outcome.ok) return outcome;

  const varianceAmount = variance ? await computeVarianceAmount(userId, tenantId, ref) : null;

  await withTenantAs(getDb(), userId, tenantId, (t) =>
    t.execute(sql`
      update match_candidates
         set status = 'accepted', decided_by = ${userId}, decided_at = now(),
             variance_kind = ${variance?.kind ?? null}, variance_amount = ${varianceAmount}
       where id = ${ref.id} and tenant_id = ${tenantId}
    `),
  );

  return { ok: true, transactionId: outcome.transactionId };
}

/**
 * `POST /v1/reconciliation/candidates/:id/accept`. D-S6: this IS the posting
 * act — there is no separate confirm step after it.
 */
export async function acceptCandidate(
  userId: string,
  tenantId: string,
  candidateId: string,
  variance?: { kind: MatchVarianceKind },
): Promise<DecideOutcome> {
  const candidate = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      status: string;
      statement_line_id: string;
      document_id: string;
    }>(sql`
      select id, status::text as status, statement_line_id, document_id
        from match_candidates where id = ${candidateId}
    `);
    return rows.rows[0] ?? null;
  });
  if (!candidate) return { ok: false, reason: 'missing_candidate' };
  if (candidate.status !== 'suggested') {
    return { ok: false, reason: 'already_decided', status: candidate.status };
  }

  return supersedeAndDecide(
    userId,
    tenantId,
    { id: candidate.id, documentId: candidate.document_id, statementLineId: candidate.statement_line_id },
    variance,
  );
}

/**
 * `POST /v1/reconciliation/candidates/:id/reject`. Any non-readonly member
 * (the controller checks the role) — rejecting does not touch the ledger.
 * `UNIQUE (statement_line_id, document_id)` is for life: a rejected row
 * simply stays, so the matcher's own `ON CONFLICT DO NOTHING` in
 * `listCandidates` never resurrects it.
 */
export async function rejectCandidate(
  userId: string,
  tenantId: string,
  candidateId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'missing_candidate' }
  | { ok: false; reason: 'already_decided'; status: string }
> {
  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ id: string; status: string }>(sql`
      select id, status::text as status from match_candidates where id = ${candidateId}
    `);
    const row = rows.rows[0];
    if (!row) return { ok: false, reason: 'missing_candidate' };
    if (row.status !== 'suggested') return { ok: false, reason: 'already_decided', status: row.status };

    await t.execute(sql`
      update match_candidates set status = 'rejected', decided_by = ${userId}, decided_at = now()
       where id = ${candidateId}
    `);
    return { ok: true };
  });
}

/**
 * `POST /v1/reconciliation/matches` — a human names a pair directly, not
 * subject to the generator's card-mismatch EXCLUSION (that governs what is
 * SUGGESTED, never what a person may deliberately link). Re-links a
 * previously rejected or unlinked pair by FLIPPING the existing
 * `match_candidates` row — §5.3.1's own words: "re-linking flips this row
 * rather than adding one" — rather than colliding with the unique pair
 * constraint.
 */
export async function manualLink(
  userId: string,
  tenantId: string,
  input: { statementLineId: string; documentId: string; variance?: { kind: MatchVarianceKind } },
): Promise<DecideOutcome | { ok: false; reason: 'missing_statement_line' } | { ok: false; reason: 'missing_document' }> {
  const tenant = await readTenant(userId, tenantId);
  const rules = tenant?.tax_rules_id ? await rulesFor(tenant) : null;

  const facts = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      line_posted_date: string;
      line_card_last4: string | null;
      line_amount_signed: string;
      document_issue_date: string | null;
      document_card_last4: string | null;
      document_payable_amount: string | null;
      supplier_name_normalised: string | null;
      description_normalised: string | null;
    }>(sql`
      select sl.posted_date::text as line_posted_date, sl.card_last4 as line_card_last4,
             sl.amount_signed::text as line_amount_signed, sl.description_normalised,
             d.issue_date::text as document_issue_date, d.card_last4 as document_card_last4,
             d.payable_amount::text as document_payable_amount, p.name_normalised as supplier_name_normalised
        from statement_lines sl, documents d
        left join parties p on p.id = d.supplier_id
       where sl.id = ${input.statementLineId} and sl.tenant_id = ${tenantId}
         and d.id = ${input.documentId} and d.tenant_id = ${tenantId} and d.deleted_at is null
    `);
    return rows.rows[0] ?? null;
  });
  if (!facts) {
    // Either id is missing under this tenant — RLS already narrowed both
    // selects, so "not found" and "belongs to another tenant" look the same,
    // exactly as everywhere else in this codebase. A cheap existence check
    // distinguishes which one for the 404 message; not load-bearing for
    // correctness, only for a clearer error.
    return withTenantAs(getDb(), userId, tenantId, async (t) => {
      const line = await t.execute<{ id: string }>(sql`select id from statement_lines where id = ${input.statementLineId}`);
      if (!line.rows[0]) return { ok: false, reason: 'missing_statement_line' };
      return { ok: false, reason: 'missing_document' };
    });
  }

  const merchantSimilarity = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ similarity: number }>(sql`
      select coalesce(similarity(${facts.description_normalised}, ${facts.supplier_name_normalised}), 0)::float8 as similarity
    `);
    return rows.rows[0]?.similarity ?? 0;
  });

  const amountExact = money.compare(
    money.money(facts.document_payable_amount ?? '0'),
    money.negate(money.money(facts.line_amount_signed)),
  ) === 0;

  const evidence = evaluateManualLinkFacts(
    {
      lineId: input.statementLineId,
      documentId: input.documentId,
      linePostedDate: facts.line_posted_date,
      lineCardLast4: facts.line_card_last4,
      documentIssueDate: facts.document_issue_date,
      documentCardLast4: facts.document_card_last4,
      merchantSimilarity,
      amountExact,
    },
    rules,
  );

  // Upsert: a fresh pair inserts 'suggested' (the SAME state the matcher
  // would leave one in); an existing pair of ANY status — including
  // 'rejected' or 'unlinked' — is left exactly as it is by this step. Either
  // way `supersedeAndDecide` below is what actually flips it to 'accepted',
  // on success only, same as `acceptCandidate`. `RETURNING id` fires on both
  // the insert and the no-op update.
  const candidateId = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const row = await t.execute<{ id: string }>(sql`
      insert into match_candidates (
        id, tenant_id, statement_line_id, document_id, status, proposed_by, matcher_version, evidence
      ) values (
        ${randomUUID()}, ${tenantId}, ${input.statementLineId}, ${input.documentId}, 'suggested', 'user',
        null, ${JSON.stringify(evidence)}::jsonb
      )
      on conflict (statement_line_id, document_id) do update set evidence = match_candidates.evidence
      returning id
    `);
    return row.rows[0]!.id;
  });

  return supersedeAndDecide(
    userId,
    tenantId,
    { id: candidateId, documentId: input.documentId, statementLineId: input.statementLineId },
    input.variance,
  );
}

/* ── Unlink ────────────────────────────────────────────────────────────────── */

export type UnlinkOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing_observation' }
  | { ok: false; reason: 'not_a_statement_line_observation' }
  | { ok: false; reason: 'not_a_match' }
  | (SupersedeOutcome & { ok: false });

/**
 * `POST /v1/reconciliation/observations/:id/unlink` — §5.3.1 Q5, "reversal
 * is the same act, backwards." `:id` names an `event_observations` row (the
 * STATEMENT LINE side of a match, never the document side — the document's
 * own observation is a document-confirmation concern, out of this ticket).
 *
 * Two steps, deliberately sequential rather than one transaction, because
 * `supersedeAndPost` opens its OWN — this is the shape §5.3.1 itself
 * describes: "unlink... deletes the statement-line observation... and
 * re-materialises the remaining evidence." The delete has to commit FIRST:
 * migration 0032's deferred trigger 1 forbids a VOID transaction from
 * carrying any observation, and `supersedeAndPost` only re-points/creates
 * observations for the pointers it is GIVEN (`documentId` here, `null`
 * `statementLineId`) — it has no way to know to drop a THIRD pointer it was
 * never told about. Deleting it first is what leaves the old transaction
 * with exactly one observation (the document's) by the time
 * `supersedeAndPost` voids it, which is what the old transaction needs to be
 * true for the trigger to let the void through at all.
 */
export async function unlinkObservation(
  userId: string,
  tenantId: string,
  observationId: string,
): Promise<UnlinkOutcome> {
  const found = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      kind: string;
      statement_line_id: string | null;
      document_id_on_txn: string | null;
    }>(sql`
      select eo.id, eo.kind::text as kind, eo.statement_line_id, txn.document_id as document_id_on_txn
        from event_observations eo
        join transactions txn on txn.id = eo.transaction_id
       where eo.id = ${observationId} and eo.tenant_id = ${tenantId}
    `);
    return rows.rows[0] ?? null;
  });
  if (!found) return { ok: false, reason: 'missing_observation' };
  if (found.kind !== 'statement_line') return { ok: false, reason: 'not_a_statement_line_observation' };
  // A standalone (R5d) line-post has no document on its transaction at all —
  // nothing for this endpoint to unlink. NOT decided by
  // `event_observations.candidate_id`: `supersedeAndPost` (R5b) never writes
  // that column on either observation it creates — `candidateIds` flows only
  // into `transactions.external_refs.merge.candidateIds`, the replay stamp
  // (`merge.ts`) — so the pair is looked up directly instead, below.
  if (!found.document_id_on_txn) return { ok: false, reason: 'not_a_match' };

  const candidate = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ id: string }>(sql`
      select id from match_candidates
       where tenant_id = ${tenantId} and statement_line_id = ${found.statement_line_id}
         and document_id = ${found.document_id_on_txn} and status = 'accepted'
    `);
    return rows.rows[0] ?? null;
  });
  if (!candidate) return { ok: false, reason: 'not_a_match' };

  await withTenantAs(getDb(), userId, tenantId, async (t) => {
    await t.execute(sql`delete from event_observations where id = ${found.id} and tenant_id = ${tenantId}`);
    await t.execute(sql`
      update match_candidates set status = 'unlinked' where id = ${candidate.id} and tenant_id = ${tenantId}
    `);
  });

  return supersedeAndPost(userId, tenantId, {
    documentId: found.document_id_on_txn,
    statementLineId: null,
  });
}
