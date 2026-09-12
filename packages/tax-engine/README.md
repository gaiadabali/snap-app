# @snap/tax-engine

Australian individual tax deduction engine — FY-versioned ATO rates, 19 occupation profiles, and
per-label deduction calculators (D1–D14 plus rental).

**Pure computation.** No DOM, no Node APIs, no framework, no I/O, no dependencies. `lib` excludes
`"dom"` on purpose: that makes a stray `document`/`window` reference a compile error rather than a
runtime crash inside the extraction worker.

```
217 tests · 13 files · 0 runtime dependencies
```

---

## Provenance

Extracted from `free-tax-returns/free-tax-return-preview/src/engine` on 2026-09-09, **byte-identical**
(verified with `diff -r`). The engine was already self-contained — its only non-relative import was
`vitest` — and the source project enforces that with an eslint boundary rule (`lint:boundaries`).
Extraction added packaging and a boundary test; it changed no engine code.

The numbers originate from a certified Australian tax consultant's spreadsheet, via
`docs/FORMULAS.md`, which is the oracle the golden tests assert against.

### ⚠️ Open launch gates inherited from the source project

Do **not** present this engine's output as authoritative tax advice until these close. They are the
source project's own records, not speculation:

| Gate | Status |
|---|---|
| **Tax-agent sign-off** on `rates/fy2026.ts`, the 365/366 proration ruling, and the benchmark drift | ☐ Unchecked launch gate in the source project's `tech-debt.md` |
| **Benchmark drift ruling** — `FORMULAS.md` says `whitecollar 21,000\|16,000`, `data.js` says `24,000\|15,500` | ☐ Open. Tests currently assert the `data.js` values pending a decision. |
| **Full-worksheet cross-validation** against the original client spreadsheet | ☐ Outstanding — the source `.xlsx` is absent from the project folder |

---

## Consuming

The package exports **TypeScript source**, not a build:

```json
"exports": { ".": "./src/index.ts" }
```

That is deliberate for an internal package — no build step, no dist/src dual source of truth, and no
chance of shipping a stale compile of tax arithmetic.

```ts
import { CURRENT_RATES, PROFILES, computeWorksheet } from '@snap/tax-engine';

const sheet = computeWorksheet(PROFILES.truckie_long, {
  d1: { cars: [{ method: 'Cents per km', km: 6000 }] },
}, CURRENT_RATES);

sheet.byLabel.D1;   // 4400  — capped at 5,000 km × $0.88
sheet.grandTotal;   // 4410  — includes the $10 receiptless D9 floor
```

### One real constraint: consume through a bundler

Engine sources use **extensionless relative imports** (`from './calc/cheatsheet'`). Bundlers and
bundler-style resolvers handle these; **raw Node ESM does not** — `node --experimental-strip-types`
fails with `ERR_MODULE_NOT_FOUND`.

| Consumer | Works? |
|---|---|
| Next.js (with `transpilePackages: ['@snap/tax-engine']`) | ✅ |
| vitest / Vite | ✅ |
| `tsx`, `tsup`, esbuild, Bun | ✅ |
| `node --experimental-strip-types` directly | ❌ |

So the extraction worker must run under `tsx` or be bundled with `tsup` — worth knowing before
scaffolding it. Rewriting all 49 files to add `.ts` extensions would fix raw-Node use but would
diverge from the source project and make future syncing harder, for no product benefit.

---

## Public surface

Everything importable is listed in [`src/index.ts`](src/index.ts). Nothing reaches into `calc/`
internals. Highlights:

| Export | Purpose |
|---|---|
| `computeWorksheet(profile, inputs, rates)` | The main entry: returns `{ byLabel, grandTotal }` |
| `CURRENT_RATES`, `FY2026` | The active rate set |
| `CURRENT_FY`, `KNOWN_FYS`, `ratesFor(fy)`, `formatFy(fy)` | FY registry, keyed by **end year as an int** (FY2026 = 1 Jul 2025 – 30 Jun 2026) |
| `PROFILES`, `OCCUPATION_GROUPS`, `OCC_FLOW`, `occResolve` | 19 occupation profiles and the picker flow |
| `carClaim`, `carBreakdown`, `declineByDate` | D1 vehicle maths |
| `mealsFortnight`, `d2Breakdown` | D2 travel and the nested meal caps |
| `d3Breakdown`, `d4Total`, `d5Breakdown` | D3 clothing, D4 self-education, D5 other |
| `stateFromPostcode` | AU postcode → state |

### Behaviour worth knowing before you rely on it

- **An empty worksheet is not zero.** Every profile claims the **$10 receiptless bucket-donation
  floor** at D9. The `tither` flow is the documented exception — its own $10 seed row already
  represents that floor, so applying it again would double-count.
- **`CURRENT_FY` is a number** (`2026`), not the `'2025-26'` label. Use `formatFy()` to display it.
- **A future FY falls back to the latest published rates** rather than returning `undefined`, so the
  app does not break every 1 July before the new rates land.
- **Cents-per-km is capped at 5,000 work km by law** — a $4,400 ceiling per vehicle per year.
- **Decline in value is valuation-capped** at the $69,674 car limit ÷ 8 years = **$8,709.25/yr max**.

---

## Snap Apps integration

The engine is what lets Snap Apps file a scan into **the exact worksheet row** a user's occupation
expects, rather than a generic category. `documents`/`categories` in the Snap Apps schema carry:

- `tenants.occupation_profile_id` — a `PROFILES` key (`truckie_long`, `nurse`, `sole`, …)
- `categories.engine_row_id` — the target row (`D1.logbook.fuel`, `D3.laundry`, `D2.meals.dinner`)

So a servo receipt for a `truckie_long` lands in the D1 logbook running-costs block; a laundromat
docket lands in D3 beside the $3.00/week home laundry allowance.

---

## Commands

```bash
pnpm test           # 217 tests: 186 engine + 31 package-boundary
pnpm test:watch
pnpm typecheck      # tsc --noEmit, strict, no dom lib
```

`smoke/boundary.test.ts` is the only test that imports **by package name** rather than by relative
path, so it is the one that catches a broken workspace link or `exports` map. It also pins every ATO
constant the rate docs name — those numbers are the crown jewel, and a mangled copy or bad merge
should fail loudly rather than quietly mis-file someone's tax return.

---

## Annual rate update

**Every June, before 1 July.** The full procedure is in
[`docs/ato-rates.md`](docs/ato-rates.md) — it lists each constant, the authoritative ATO source to
re-check, and how the golden tests pin it. In short:

1. Re-scrape the ATO sources; note the new TD number.
2. Add `src/rates/fy20XX.ts` — **never edit history** — and point `CURRENT_FY`/`RATES_BY_FY` at it.
   Set `daysInFy` to 365, or 366 when the FY spans a 29 February (e.g. FY2027-28).
3. Copy the FY golden test with the new values and invariants.
4. Get tax-agent sign-off (annual gate).
5. `pnpm test` — golden fixtures must stay green — then deploy before 1 July.
6. Record it in the source project's `decisions.md`.

Because both products now consume this package, that update happens **once**.

---

## Follow-up: de-duplicate the source project

`free-tax-returns` still has its own copy at `src/engine/`. It is near launch, so it was left
untouched rather than refactored underneath a live product. To finish the job when that project has
room:

1. Add `@snap/tax-engine` as a dependency of `free-tax-return-preview`.
2. Point the `@/engine` path alias at the package, or rewrite imports to the package name.
3. Delete `src/engine/`; keep the eslint boundary rule pointed at the package.
4. Add `transpilePackages: ['@snap/tax-engine']` to `next.config.ts`.

Until then there are two copies, and this one is downstream. Re-run the `diff -r` drift check before
trusting either.
