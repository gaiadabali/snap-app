import { AU_2025, AU_2026, AU_2027, ID_2026, type TaxRules } from '@snap/tax-rules';

/**
 * Rule sets compiled into this binary (see `taxrules.repo.ts` for why they are
 * built in), every year of every country, oldest first within a country.
 * The catalogue shows one per country (`availableRules`); a document is
 * assessed under the year its date falls in (`tenantRulesFor`).
 */
export const BUILTIN: TaxRules[] = [AU_2025, AU_2026, AU_2027, ID_2026];

/**
 * The consumption tax's local name for a workspace country: the installed rule
 * set's name where this binary has one (`PPN`), else `GST`, which is what
 * Australia and every country with no rule set has always been called here.
 */
export function taxNameForCountry(country: string | null | undefined): string {
  return BUILTIN.find((r) => r.country === country)?.consumptionTax.name ?? 'GST';
}
