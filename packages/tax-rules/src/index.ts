/**
 * Public surface of the tax-rule set engine.
 *
 * Consumers import from `@snap/tax-rules` and never reach into `rules/` or the
 * internals. A rule set is DATA; `interpreter.ts` is the only thing that computes.
 */

export type {
  AlternativeRegime,
  BankInterestTreatment,
  ConsumptionTaxSpec,
  CurrencySpec,
  DocumentRules,
  ExemptCategory,
  OtherTaxSpec,
  PackTaxCode,
  PeriodSpec,
  PersonalAllowance,
  Rational,
  StandardDeduction,
  StatementRules,
  TaxBracket,
  TaxIdSpec,
  TaxRules,
  TaxpayerScope,
} from './contract.js';

export {
  ZERO,
  add,
  applyRate,
  compare,
  formatLocalAmount,
  inclusiveOf,
  linesGap,
  multiplyRational,
  parseLocalAmount,
  rational,
  rationalToString,
  rationalsEqual,
  reconcileTolerance,
  roundToCurrency,
  subtract,
} from './money.js';

export { RulesRejected, assertRules, inspectRules, rulesCoverDate } from './verify.js';
export type { RulesProblem } from './verify.js';

export { NoRulesInstalled, RulesScopeMismatch, TaxRulesRegistry, rulesIdFor } from './registry.js';
export type { InstalledRules, RulesSource, RegistryOptions } from './registry.js';

export {
  alternativeRegime,
  checkStatedTax,
  checkTaxId,
  confusableTaxes,
  consumptionTaxPaid,
  consumptionTaxDisclosure,
  datePlausible,
  daysBetween,
  incomeTax,
  periodOf,
  personalAllowance,
  standardDeduction,
  taxFromInclusive,
  taxOnSale,
  withinPostingLag,
} from './interpreter.js';
export type {
  AlternativeRegimeResult,
  BracketSlice,
  ConsumptionTaxPaid,
  ConsumptionTaxResult,
  HouseholdStatus,
  IncomeTaxResult,
  RulesStamp,
} from './interpreter.js';

export { currentRules, familiesOf, familyKey, familyOf, inspectFamily, rulesForDate } from './years.js';
export type { RulesForDate, RulesMatch } from './years.js';

export { AU_2025 } from './rules/au-2025.js';
export { AU_2026 } from './rules/au-2026.js';
export { AU_2027 } from './rules/au-2027.js';
export { ID_2026 } from './rules/id-2026.js';
