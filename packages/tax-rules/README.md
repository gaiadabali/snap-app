# @snap/tax-rules

**One tax engine at a time, chosen by country, swappable without shipping a
build.**

A *rule set* is the tax law of one country for one year, as **data**. The
*interpreter* is fixed code that reads it. Exactly one rule set is installed;
switching country replaces it. The app is the same size whether it supports two
jurisdictions or forty.

---

## The rule that shapes everything here

> **A rule set is data. It is never code.**

Not a style preference. Three consequences, each of which would otherwise bite:

1. **App Store guideline 2.5.2 prohibits downloading executable code.** An app
   that fetches JavaScript and evaluates it gets rejected. A rule set is a rate
   table; the evaluator ships in the binary. That is the difference between
   "updates its tax rules over the air" and "gets pulled from the store."
2. **Data can be verified before it is trusted.** `verify.ts` checks shape,
   internal agreement and effective dates before anything computes with it.
   There is no cheap equivalent for a downloaded function.
3. **Data can be replayed.** Every result carries `rulesId` and `rulesVersion`, so
   a figure stored today can be re-derived under the same law in three years —
   README principle 2.

If a jurisdiction needs a rule the contract cannot express, **widen the contract
and the interpreter**. A rule set that needs its own logic has become code.

---

## What is in the box

| File | Holds |
|---|---|
| `contract.ts` | What a rule set *is*. Pure types, JSON-serialisable, zero behaviour |
| `money.ts` | Exact BigInt decimal + rational arithmetic, and local-format parsing |
| `verify.ts` | Refusing a bad rule set, with every reason — never partial acceptance |
| `registry.ts` | The installed-engine store. One at a time, atomic replace, no fallback |
| `interpreter.ts` | The engine. The only code that computes |
| `rules/id-2026.ts` | Indonesia, personal taxpayer, tax year 2026 |

```ts
import { TaxRulesRegistry, ID_2026, incomeTax } from '@snap/tax-rules';

const registry = new TaxRulesRegistry({ builtin: [ID_2026] });
await registry.install('id-2026');

const rule set = registry.requireFor('personal', '2026-06-01');
const result = incomeTax(rule set, {
  grossIncome: '300000000',
  status: { married: true, dependants: 2 },
  deductionCodes: ['biaya_jabatan'],
});
// result.taxPayable === '27975000.000000', stamped with rulesVersion '2026.1.0'
```

---

## Four refusals worth knowing about

Each has a test that fires it, because a guard only ever seen letting good input
through has not been observed.

- **No rule set installed → every calculation throws.** There is deliberately no
  fallback. An Indonesian user silently getting Australian rules would produce
  plausible numbers under the wrong law, and nothing about a running system
  looks different when it is wrong.
- **A failed install leaves the previous rule set active.** Verify first, swap
  second. Never an app with no engine, never a half-applied jurisdiction.
- **A rule set outside its effective window refuses.** `id-2026` closes on
  `2026-12-31`. An open-ended rule set compiled into a binary would keep applying
  2026 rates in 2028 and look healthy doing it — the exact staleness
  `test/boundaries.test.ts` bans `@snap/tax-engine` from clients to avoid.
- **A personal rule set cannot mark consumption tax recoverable**, and cannot
  declare a filing period for it. A rule set that says both describes two different
  taxpayers.

---

## Indonesia, and the three things that are not Australia

Full research and sources: [`docs/INDONESIA.md`](../../docs/INDONESIA.md).

**PPN is 12% on a base of 11/12, giving 11% effective** (PMK 131/2024). So tax
inside an inclusive total is `11/111`, not `1/11` — and `taxable + tax` does
**not** re-add to the payable, because the faktur prints the reduced base. The
rule set states the rate, the base fraction and the inclusive fraction separately,
and `verify.ts` checks that the three agree rather than deriving one and hoping.

**PB1 is not PPN.** A restaurant bill prints a 10% regional tax one line from
where PPN would print, at a rate close enough to pass a loose check, and it is
never recoverable. Australia has no second 10% tax on a docket, so nothing in
the existing reader has a concept for it. `confusableTaxes()` surfaces
candidates for a human and never returns a verdict — the rate is set by each
regency, so the app cannot assert which tax it is looking at.

**Rupiah inverts the separators.** `Rp 1.234.567,89`, and `15.000` is fifteen
thousand. The existing money parser accepts that as `15.0000` silently, and
every downstream check passes because the tax arithmetic stays internally
consistent whatever the magnitude. `parseLocalAmount()` takes the convention
from the rule set and **refuses** anything that does not fit it, rather than
coercing. Fail closed: a number we cannot read is not a number we may assume.

---

## What this package does NOT do

- **It is not a deduction engine, and Indonesia does not have one.** There is no
  D1–D14 analogue for an individual. A PP 23 taxpayer pays 0.5% of turnover with
  no deductions at all, and `alternativeRegime()` says so in
  `note` so a UI cannot imply otherwise.
- **It does not produce a PPN return for a personal taxpayer**, because there
  isn't one. SPT Masa PPN is a PKP filing. `consumptionTaxPaid()` returns a
  spending analytic carrying a `disclosure` sentence stating that it is not a
  claim.
- **It does not replace `@snap/tax-engine`.** Australia stays where it is, with
  its 217 golden tests untouched. Wrapping AU as a rule set is a separate decision.

---

## Checks

```bash
pnpm --filter @snap/tax-rules test        # 78 tests
pnpm --filter @snap/tax-rules typecheck
pnpm test:boundaries                      # the package must be declared there
```

The suite was verified by mutation, not by going green: deleting the three-way
PPN agreement check, making `require()` fall back to a built-in, and computing
the document base the Australian way each fail exactly the test that names the
behaviour, and nothing else.
