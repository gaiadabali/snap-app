import { withTenantAs } from '@snap/db';
import {
  NoRulesInstalled,
  RulesRejected,
  TaxRulesRegistry,
  add,
  consumptionTaxDisclosure,
  currentRules,
  familyOf,
  roundToCurrency,
  rulesForDate,
  rulesIdFor,
  type RulesForDate,
  type RulesMatch,
  type TaxRules,
} from '@snap/tax-rules';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { readTenant, type TenantRow } from '../repo.js';
import { BUILTIN } from './tax-name.js';

/**
 * Resolving a workspace's tax engine, and reporting from its ledger.
 *
 * The rule this file exists to keep: **a workspace with no installed rule set
 * gets a refusal, never Australia.** `tenants.tax_rules_id` is nullable with no
 * default precisely so that "no engine" is representable, and every path here
 * that needs rules goes through `rulesFor()`, which throws.
 *
 * Why that matters more than it sounds: an Indonesian user silently receiving
 * Australian rules would see plausible numbers — a total, a tax line, a
 * percentage — computed under the wrong law. Nothing about the screen would
 * look different. `docs/INDONESIA.md` §8 lists eighteen places Australia is
 * still compiled in, and the whole point of the registry is that a second
 * jurisdiction cannot quietly inherit any of them.
 */

/**
 * Rule sets compiled into this binary.
 *
 * The server can afford to carry every rule set it supports — the size argument
 * that drives one-at-a-time installation is a CLIENT concern. Keeping them
 * built in here means the API never needs a network round trip to answer a tax
 * question, and `TaxRulesRegistry` still enforces one-active-at-a-time per
 * request rather than per process.
 *
 * A registry is built PER REQUEST, deliberately. A module-level singleton
 * holding "the current rule set" would be a cross-tenant data leak wearing a
 * performance optimisation's clothes: this process serves many workspaces in
 * many countries concurrently.
 */

/** Rule sets this deployment can install, for the settings screen. */
export type AvailableRules = {
  rulesId: string;
  country: string;
  countryName: string;
  version: string;
  taxYear: string;
  scope: 'personal' | 'business';
  consumptionTaxName: string;
  currency: string;
};

/**
 * Today as `YYYY-MM-DD`, in UTC.
 *
 * Only the last resort of `assessmentDate`, and the "current year" of the
 * catalogue and the settings screen. UTC rather than a local zone because the
 * server has no single local zone; it only matters for a document with no
 * date of its own read in the first hours of 1 July in Australia.
 */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The date a document is assessed on: the first candidate that is a date.
 *
 * Callers pass, in order, the document's own date (invoice or receipt date),
 * then the capture date, and get today when neither is known. A timestamp
 * (`2026-03-15T04:00:00Z`, `2026-03-15 04:00:00+00`) counts by its date part.
 */
export function assessmentDate(...candidates: (string | Date | null | undefined)[]): string {
  for (const c of candidates) {
    if (c instanceof Date) {
      if (!Number.isNaN(c.getTime())) return c.toISOString().slice(0, 10);
      continue;
    }
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  }
  return todayIso();
}

/**
 * The catalogue: ONE rule set per country, the year covering `onDate` (today).
 *
 * The binary holds every year it knows (`au-2025`, `au-2026`, `au-2027`), but
 * a person picks a country, not a year — three Australias in a sign-up list
 * would be a question nobody can answer. Whichever year they install, the
 * workspace's documents are each assessed under the year of their own date
 * (`tenantRulesFor`).
 */
export function availableRules(onDate: string = todayIso()): AvailableRules[] {
  return currentRules(BUILTIN, onDate).map((r) => ({
    rulesId: r.id,
    country: r.country,
    countryName: r.countryName,
    version: r.version,
    taxYear: r.taxYear,
    scope: r.scope,
    consumptionTaxName: r.consumptionTax.name,
    currency: r.currency.code,
  }));
}

/** A rule set this binary holds, of any year, or undefined. */
export function heldRules(rulesId: string): TaxRules | undefined {
  return BUILTIN.find((r) => r.id === rulesId);
}

/**
 * A workspace's tax law, per date.
 *
 * `installed` is what the workspace stored: since several years exist it
 * identifies the COUNTRY (and the version the workspace was told it has), not
 * the year a figure is computed under. `on(date)` is the year that date
 * belongs to — what every figure is computed under and stamped with.
 */
export type TenantRules = {
  installed: TaxRules;
  on(isoDate: string): RulesForDate;
};

/**
 * The workspace's rule-set family, verified once.
 *
 * Throws `NoRulesInstalled` when the column is null. That is not an error
 * condition to be smoothed over — it is the honest answer between "the user
 * picked a country" and "the engine for it was installed".
 */
export async function tenantRulesFor(tenant: TenantRow): Promise<TenantRules> {
  const registry = new TaxRulesRegistry({ builtin: BUILTIN });
  if (!tenant.tax_rules_id) {
    throw new NoRulesInstalled(`a tax calculation for ${tenant.name}`);
  }
  await registry.install(tenant.tax_rules_id);
  const installed = registry.require();

  // The stored version is what the workspace was last told it had. If the
  // binary now carries a different one, the workspace is computing under law
  // it never agreed to — surfaced rather than silently upgraded, because a
  // figure stored under 2026.1.0 must stay re-derivable under 2026.1.0.
  // Checked against the STORED id: adding a year beside it is not an upgrade
  // of it.
  if (tenant.tax_rules_version && tenant.tax_rules_version !== installed.version) {
    throw new NoRulesInstalled(
      `a tax calculation: this workspace has ${tenant.tax_rules_id} ` +
        `${tenant.tax_rules_version} installed, but this server carries ${installed.version}. ` +
        'Reinstall the tax engine from settings to move to the current rules.',
    );
  }

  const family = familyOf(BUILTIN, installed);
  return { installed, on: (isoDate) => rulesForDate(family, isoDate) };
}

/**
 * The rule set for this workspace on `onDate`: the year that date falls in.
 *
 * `onDate` is required, not defaulted, so every caller says which date it
 * means — a document's own date, a period's, or today for a screen that shows
 * "the current year".
 */
export async function rulesFor(tenant: TenantRow, onDate: string): Promise<TaxRules> {
  return (await tenantRulesFor(tenant)).on(onDate).rules;
}

/**
 * The month (1-12) this workspace's tax year starts in: 7 for an Australian
 * one, 1 for an Indonesian one.
 *
 * From the installed rule set's `periods.taxYearStartMonth`, the same field
 * `periodOf()` reads. A workspace with no rule set installed (an Australian
 * business on the BAS engine, `tax_rules_id` null) falls back to
 * `tenants.financial_year_start_month`, which `installRulesFor` copies from
 * that very field and which defaults to 7, so the two cannot name different
 * years for a workspace that has an engine.
 */
export async function taxYearStartMonthFor(
  tenant: TenantRow,
  onDate: string = todayIso(),
): Promise<number> {
  try {
    return (await tenantRulesFor(tenant)).on(onDate).rules.periods.taxYearStartMonth;
  } catch (e) {
    if (e instanceof NoRulesInstalled || e instanceof RulesRejected) {
      return tenant.financial_year_start_month;
    }
    throw e;
  }
}

/** The receipt reader's rule set on a date, or `null` for the Australian reader. */
export type ReaderRulesOn = (isoDate: string) => TaxRules | null;

/**
 * The same mapping `readerRulesResolver` applies, from an already-verified
 * family — shared with `worker.ts`, which must see the installed rule set
 * itself first (its country check) and then resolves per document.
 */
export function readerRulesOf(tenantRules: TenantRules): ReaderRulesOn {
  return (isoDate) => {
    const rules = tenantRules.on(isoDate).rules;
    return rules.country === 'AU' ? null : rules;
  };
}

/**
 * The rule set the RECEIPT READER should apply for this workspace on a date,
 * or `null` for Australia — as a function of the date, so a list of documents
 * resolves the workspace once and each document by its own date.
 *
 * Australia's reader predates rule sets: `jurisdictionOf(null)` in
 * `extraction/validators.ts` (GST exactly 1/11, the ABN checksum, the $82.50
 * tax-invoice and $1,000 buyer-ABN thresholds), the tuned Australian
 * extraction prompt, and `@snap/tax-engine` behind them. The `au-*` rule sets
 * declare Australia so a person can pick it; they do not replace that reader.
 * So an Australian workspace reads a receipt the same way whether it installed
 * an `au-*` rule set at sign-up or predates them with no rule set at all —
 * two classes of Australian workspace reading the same docket differently is
 * the outcome this exists to prevent. `validators.au.test.ts` checks that
 * every figure both of them state agrees, for every Australian year.
 *
 * This is not a fallback. A workspace with NO rule set gets `null` only by the
 * same rule every caller already used (`tax_rules_id` null); one whose rule
 * set fails to load or is the wrong version still throws through
 * `tenantRulesFor`, Australian or not; and only a rule set that loaded AND is
 * Australian maps to the Australian reader.
 *
 * Statement imports do not use this: they need a real rule set (posting lag,
 * bank interest, the amount format) and have no Australian built-in, so they
 * call `rulesFor` directly.
 */
export async function readerRulesResolver(tenant: TenantRow | null | undefined): Promise<ReaderRulesOn> {
  if (!tenant?.tax_rules_id) return () => null;
  return readerRulesOf(await tenantRulesFor(tenant));
}

/** `readerRulesResolver` for one date. */
export async function readerRulesFor(
  tenant: TenantRow | null | undefined,
  onDate: string,
): Promise<TaxRules | null> {
  return (await readerRulesResolver(tenant))(onDate);
}

/**
 * What an extraction run records about the law it was assessed under, in
 * `extraction_runs.validator_report.rules`.
 *
 * README principle 2: a stored result must name the rule set and version it
 * was computed under, so it can be re-derived after more years are added.
 * `reader` says which code read it: an Australian receipt is still read by the
 * built-in Australian reader (`readerRulesFor` maps it to `null`), which
 * `validators.au.test.ts` keeps in agreement with every `au-*` year, so the
 * stamp names the Australian year in force on the document's date.
 */
export type RulesStampRecord = {
  rulesId: string;
  rulesVersion: string;
  /** The date the rule set was chosen for, `YYYY-MM-DD`. */
  onDate: string;
  /** `exact`, or which fallback chose it (`years.ts`). */
  match: RulesMatch;
  reader: 'rule_set' | 'au_builtin';
};

export function rulesStampOf(tenantRules: TenantRules, onDate: string): RulesStampRecord {
  const { rules, match } = tenantRules.on(onDate);
  return {
    rulesId: rules.id,
    rulesVersion: rules.version,
    onDate,
    match,
    reader: rules.country === 'AU' ? 'au_builtin' : 'rule_set',
  };
}

/** Install (or replace) the rule set for a workspace. */
export async function installRulesFor(
  userId: string,
  tenantId: string,
  rulesId: string,
): Promise<TaxRules> {
  // Verified through the registry BEFORE anything is written, so a workspace
  // can never end up pointing at a rule set that does not load.
  const registry = new TaxRulesRegistry({ builtin: BUILTIN });
  await registry.install(rulesId);
  const rules = registry.require();

  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    // `country`, `base_currency` and `financial_year_start_month` move WITH the
    // engine. Leaving them behind is how a workspace ends up Indonesian for tax
    // and Australian for its financial year — two correct facts that disagree.
    await tx.execute(sql`
      update tenants set
        tax_rules_id = ${rules.id},
        tax_rules_version = ${rules.version},
        country = ${rules.country},
        base_currency = ${rules.currency.code},
        financial_year_start_month = ${rules.periods.taxYearStartMonth}
      where id = ${tenantId}
    `);
  });

  return rules;
}

/* ── The consumption-tax analytic ──────────────────────────────────────────── */

export type ConsumptionTaxLine = {
  code: string;
  name: string;
  /** What the rule set says this code is. Drives how the UI groups it. */
  treatment: 'standard' | 'exempt' | 'other_tax' | 'out_of_scope';
  grossAmount: string;
  taxAmount: string;
  transactionCount: number;
};

export type ConsumptionTaxReport = {
  from: string;
  to: string;
  rulesId: string;
  rulesVersion: string;
  /** `PPN`, `GST`. */
  taxName: string;
  currency: string;
  grossSpend: string;
  taxPaid: string;
  exemptSpend: string;
  /** Tax that is a DIFFERENT tax — PB1 and the like. Never recoverable. */
  otherTaxPaid: string;
  recoverable: boolean;
  /**
   * What this figure is, in one sentence, from the engine.
   *
   * The surface prints this verbatim. It is the difference between a spending
   * analytic and an implied claim, and a screen is not allowed to decide which
   * one it is showing.
   */
  disclosure: string;
  /**
   * Set when the rule set declares no filing period for this tax.
   *
   * For a personal Indonesian taxpayer there is no SPT Masa PPN — that is a
   * PKP filing. `docs/INDONESIA.md` §4.3. The UI must not render a "period"
   * or a "lodge" affordance when this is true.
   */
  filingPeriod: 'monthly' | 'quarterly' | 'annual' | 'none';
  lines: ConsumptionTaxLine[];
};

type Row = {
  code: string;
  name: string;
  gross: string;
  tax: string;
  txn_count: string;
};

/**
 * How much consumption tax this workspace paid over a period.
 *
 * Sums the LEDGER rather than recomputing from inclusive amounts, because the
 * tax stored on a split came from the figure printed on the document, and the
 * printed figure is the fact — a till that rounds differently is still the
 * source of truth for what was charged (the same reasoning
 * `extraction/tax-subtotals.ts` already applies).
 *
 * Posted only. A draft is not spending that happened.
 */
export async function consumptionTaxReport(
  userId: string,
  tenantId: string,
  from: string,
  to: string,
): Promise<ConsumptionTaxReport> {
  const tenant = await readTenant(userId, tenantId);
  if (!tenant) throw new NoRulesInstalled('a tax calculation for an unknown workspace');
  // A period, not one document: resolved by the period's END date, and the
  // report stamps the year it chose (`rulesId` / `rulesVersion`). The figures
  // themselves are summed from the ledger, and what the rule set adds here —
  // the tax's name, the code classification, the disclosure — is identical
  // across the Australian years (`years.test.ts` asserts it), so a period
  // that straddles 30 June is classified the same under either year.
  const rules = await rulesFor(tenant, to);

  const rows = await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      select tc.code                        as code,
             tc.name                        as name,
             -- amount is the NET figure and gst_amount the tax beside it,
             -- exactly as v_bas_lines (migration 0006) reads them. Summing
             -- amount alone and calling it gross understates every total by
             -- its own tax, which is the kind of error that looks plausible.
             coalesce(sum(abs(s.amount) + s.gst_amount), 0) as gross,
             coalesce(sum(s.gst_amount), 0)                 as tax,
             count(distinct t.id)                           as txn_count
        from transaction_splits s
        join transactions t on t.id = s.transaction_id
        join tax_codes    tc on tc.id = s.tax_code_id
       where t.status = 'posted'
         and t.txn_date >= ${from}::date
         and t.txn_date <= ${to}::date
         and tc.country = ${rules.country}
       group by tc.code, tc.name
       order by tc.code
    `);
    return r.rows;
  });

  // Classification comes from the rule set, not from a string match in this
  // file. An `otherTaxes` code is PB1-shaped: it prints like the main tax, is
  // never recoverable, and must never be added into `taxPaid`.
  const otherTaxCodes = new Set(rules.otherTaxes.map((t) => t.code));
  // A code's own declared treatment wins (`au-2026` declares every one —
  // Australia's GST-free code is `FRE`, which no name match would find). A
  // rule set that predates the field (`id-2026`) keeps the older heuristic.
  const declared = new Map(
    rules.taxCodes.filter((c) => c.treatment).map((c) => [c.code, c.treatment!] as const),
  );
  const exemptCodes = new Set(
    rules.taxCodes.filter((c) => c.ratePercent === 0 && c.code.includes('BEBAS')).map((c) => c.code),
  );
  const standardRate = rules.taxCodes.find(
    (c) => c.ratePercent > 0 && !otherTaxCodes.has(c.code),
  )?.code;

  const lines: ConsumptionTaxLine[] = rows.map((row) => ({
    code: row.code,
    name: row.name,
    treatment: otherTaxCodes.has(row.code)
      ? 'other_tax'
      : (declared.get(row.code) ??
        (exemptCodes.has(row.code)
          ? 'exempt'
          : row.code === standardRate
            ? 'standard'
            : 'out_of_scope')),
    grossAmount: row.gross,
    taxAmount: row.tax,
    transactionCount: Number(row.txn_count),
  }));

  // Exact decimal sums (BigInt in `@snap/tax-rules`), rounded once at the end.
  // Float addition was close enough for whole rupiah and is not for cents.
  const sum = (pick: (l: ConsumptionTaxLine) => string, where: (l: ConsumptionTaxLine) => boolean) =>
    toMinorUnits(roundToCurrency(add('0', ...lines.filter(where).map(pick)), rules.currency), rules.currency.minorUnits);

  return {
    from,
    to,
    rulesId: rules.id,
    rulesVersion: rules.version,
    taxName: rules.consumptionTax.name,
    currency: rules.currency.code,
    grossSpend: sum((l) => l.grossAmount, () => true),
    // Deliberately excludes `other_tax`. PB1 is not PPN and folding it in
    // would overstate the figure by a tax the user can never recover.
    taxPaid: sum((l) => l.taxAmount, (l) => l.treatment === 'standard'),
    exemptSpend: sum((l) => l.grossAmount, (l) => l.treatment === 'exempt'),
    otherTaxPaid: sum((l) => l.taxAmount, (l) => l.treatment === 'other_tax'),
    recoverable: rules.consumptionTax.recoverable,
    disclosure: consumptionTaxDisclosure(rules),
    filingPeriod: rules.periods.consumptionTaxPeriod,
    lines,
  };
}

/**
 * An already-rounded decimal string printed with exactly `minorUnits` places,
 * the shape this report has always answered with (`110000`, `24.50`).
 */
function toMinorUnits(amount: string, minorUnits: number): string {
  const neg = amount.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? amount.slice(1) : amount).split('.');
  const digits = minorUnits === 0 ? whole : `${whole}.${frac.padEnd(minorUnits, '0').slice(0, minorUnits)}`;
  return neg && /[1-9]/.test(digits) ? `-${digits}` : digits;
}

/** The rule set id a country would install, for the settings screen. */
export function candidateRulesId(country: string, taxYear: string): string {
  return rulesIdFor(country, taxYear);
}
