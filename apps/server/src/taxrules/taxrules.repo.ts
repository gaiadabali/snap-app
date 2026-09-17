import { withTenantAs } from '@snap/db';
import {
  ID_2026,
  NoRulesInstalled,
  TaxRulesRegistry,
  consumptionTaxDisclosure,
  rulesIdFor,
  type TaxRules,
} from '@snap/tax-rules';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { readTenant, type TenantRow } from '../repo.js';

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
const BUILTIN: TaxRules[] = [ID_2026];

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

export function availableRules(): AvailableRules[] {
  return BUILTIN.map((r) => ({
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

/**
 * The rule set installed for this workspace.
 *
 * Throws `NoRulesInstalled` when the column is null. That is not an error
 * condition to be smoothed over — it is the honest answer between "the user
 * picked a country" and "the engine for it was installed".
 */
export async function rulesFor(tenant: TenantRow): Promise<TaxRules> {
  const registry = new TaxRulesRegistry({ builtin: BUILTIN });
  if (!tenant.tax_rules_id) {
    throw new NoRulesInstalled(`a tax calculation for ${tenant.name}`);
  }
  await registry.install(tenant.tax_rules_id);
  const rules = registry.require();

  // The stored version is what the workspace was last told it had. If the
  // binary now carries a different one, the workspace is computing under law
  // it never agreed to — surfaced rather than silently upgraded, because a
  // figure stored under 2026.1.0 must stay re-derivable under 2026.1.0.
  if (tenant.tax_rules_version && tenant.tax_rules_version !== rules.version) {
    throw new NoRulesInstalled(
      `a tax calculation: this workspace has ${tenant.tax_rules_id} ` +
        `${tenant.tax_rules_version} installed, but this server carries ${rules.version}. ` +
        'Reinstall the tax engine from settings to move to the current rules.',
    );
  }
  return rules;
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
  const rules = await rulesFor(tenant);

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
      : exemptCodes.has(row.code)
        ? 'exempt'
        : row.code === standardRate
          ? 'standard'
          : 'out_of_scope',
    grossAmount: row.gross,
    taxAmount: row.tax,
    transactionCount: Number(row.txn_count),
  }));

  const sum = (pick: (l: ConsumptionTaxLine) => string, where: (l: ConsumptionTaxLine) => boolean) =>
    lines
      .filter(where)
      .reduce((acc, l) => acc + Number(pick(l)), 0)
      .toFixed(rules.currency.minorUnits);

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

/** The rule set id a country would install, for the settings screen. */
export function candidateRulesId(country: string, taxYear: string): string {
  return rulesIdFor(country, taxYear);
}
