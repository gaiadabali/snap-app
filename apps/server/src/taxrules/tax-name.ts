import { ID_2026, type TaxRules } from '@snap/tax-rules';

/** Rule sets compiled into this binary (see `taxrules.repo.ts` for why they are built in). */
export const BUILTIN: TaxRules[] = [ID_2026];

/**
 * The consumption tax's local name for a workspace country: the installed rule
 * set's name where this binary has one (`PPN`), else `GST`, which is what
 * Australia and every country with no rule set has always been called here.
 */
export function taxNameForCountry(country: string | null | undefined): string {
  return BUILTIN.find((r) => r.country === country)?.consumptionTax.name ?? 'GST';
}
