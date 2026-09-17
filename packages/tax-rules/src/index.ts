/**
 * Public surface of the tax-rule set engine.
 *
 * Consumers import from `@snap/tax-rules` and never reach into `rules/` or the
 * internals. A rule set is DATA; `interpreter.ts` is the only thing that computes.
 */

export type {
  AlternativeRegime,
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
  incomeTax,
  periodOf,
  personalAllowance,
  standardDeduction,
  taxFromInclusive,
  taxOnSale,
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

export { ID_2026 } from './rules/id-2026.js';
