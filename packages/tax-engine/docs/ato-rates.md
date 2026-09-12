# ATO rates — verification procedure

> **Every ATO constant in the product lives in `src/engine/rates/fy2026.ts` and nowhere else.**
> This file is the yearly re-verification skill: what each constant is, the authoritative source
> to re-check, how the golden tests pin it, and the open rulings. Rates change annually — re-verify
> each income year. **This is educational reference, not tax advice.**

Current set: **FY2025-26**, determination **TD 2025/4** (`CURRENT_RATES = FY2026`).
Source of the numbers: `reference/FORMULAS.md` (client spreadsheet) — tax-agent sign-off is a
launch gate (see [tech-debt.md](../docs/tech-debt.md)).

## Constants in `fy2026.ts`

| Constant | Value | What it is | Authoritative source to re-check each year |
|---|---|---|---|
| `fy` | `'2025-26'` | Income year label | — |
| `determination` | `'TD 2025/4'` | ATO determination the meal/travel rates come from | ATO Taxation Determination "TD 20XX/X" (reasonable amounts) |
| `centsPerKmRate` | `0.88` | D1 car cents-per-km rate ($/km) | ATO "Cents per kilometre method" |
| `centsPerKmCapKm` | `5_000` | D1 max claimable work km (by law) | ATO "Cents per kilometre method" |
| `carCostLimit` | `69_674` | Car depreciation cost/valuation cap ($) | ATO "Car limit" (LCT-derived, indexed) |
| `carEffectiveLifeYears` | `8` | Prime-cost effective life for cars | ATO "Effective life of depreciating assets" |
| `mealDailyLimit` | `165.0` | Overtime/travel meals reasonable daily total ($, income < threshold) | TD 20XX/X Table 1 |
| `mealDailyLimitHigh` | `201.35` | Reasonable daily total at/above the high-income threshold | TD 20XX/X (scaled per calc.js by `limit/165`) |
| `mealHighIncomeThreshold` | `148_250` | Salary threshold splitting the two meal bands ($) | TD 20XX/X |
| `mealBreakdown` | breakfast 34.75 · lunch 39.10 · dinner 66.65 · incidentals 24.50 | Per-meal split; **sums exactly to `mealDailyLimit` (165.00)** | TD 20XX/X Table 1 |
| `homeLaundryPerWeek` | `3.0` | D3 laundry reasonable amount ($/week) | ATO "Clothing, laundry and dry-cleaning" |
| `homeOfficeElectricityPerHour` | `0.70` | D5 WFH actual/electricity rate ($/hr) | ATO "Working from home expenses" |
| `homeOfficeFixedRatePerHour` | `0.67` | D5 WFH fixed-rate method ($/hr) | ATO "Fixed rate method" |
| `overtimeMealNoReceiptMax` | `38.65` | D2 receiptless overtime-meal cap ($) — **spreadsheet value, never 37.65** | TD 20XX/X (overtime meal allowance) |
| `capitalWorksRate` | `0.025` | Rental capital-works deduction (2.5%/yr) | ATO "Capital works deductions" (Div 43) |
| `daysInFy` | `365` | Actual days in the FY (366 when it spans 29 Feb) — drives depreciation proration | Calendar (FY2025-26 = 1 Jul 2025 → 30 Jun 2026, no 29 Feb) |

## How the golden tests pin them

`src/engine/rates/fy2026.test.ts` asserts every constant against the FORMULAS.md values, plus two
derived invariants that catch silent drift:
- **Car:** `carCostLimit / carEffectiveLifeYears ≈ $8,709.25/yr`.
- **Meals:** `breakfast + lunch + dinner + incidentals` must equal `mealDailyLimit` to the cent.
- **Overtime meal** is explicitly asserted `38.65` ("never 37.65").
- **`daysInFy === 365`** for FY2025-26; leap-FY behaviour is covered by the calc/depreciation tests.

The per-`calc/dN-*.test.ts` suites and the whole-worksheet golden fixtures compute against
`CURRENT_RATES`, so any rate edit that breaks a worked example fails CI (`pnpm test`).

## Yearly update procedure (every June, before 1 July)

1. **Re-scrape the ATO sources** in the table above for the new income year; note the new TD number.
2. **Add a new file** `src/engine/rates/fy20XX.ts` (never edit history) with the new `RateSet`, and
   point `CURRENT_RATES` at it. Set `daysInFy` to **365 or 366** (366 only when the FY spans a
   29 Feb — e.g. FY2027-28).
3. Update the FY's golden test (copy `fy2026.test.ts`) with the new values + invariants.
4. **Tax-agent sign-off** on the new rates and the proration ruling (launch/annual gate).
5. Bump **`WS_SCHEMA_VERSION`** (`src/components/worksheet/use-worksheet-store.ts`) **only if** the
   worksheet input shape changed — stale-version snapshots are then filtered on read (no migration).
6. Run `pnpm test` (golden fixtures must stay green) and deploy **before 1 July**.
7. Record the update in [decisions.md](./decisions.md).

## Open questions / rulings (from decisions.md)

- **Proration basis (RESOLVED 2026-07-03):** depreciation prorates by **actual days in the FY**
  (`daysInFy`), superseding the prototype's `365.25` (`calc.js:2538`) and an earlier flat-365 spec.
  FY2025-26 = 365; leap-FY = 366, covered by tests.
- **Benchmark drift (OPEN — client to confirm):** FORMULAS.md says Office Workers `21,000|16,000`
  and Overtime Workers `20,000|11,000`, but `data.js` (what the prototype renders) has whitecollar
  `24,000|15,500` and award `20,000|11,500`. Engine tests assert the **data.js** values pending a ruling.
- **High-income meal caps:** `calc.js:2488` scales the TD per-meal breakdown by `limit/165` so caps
  sum to `$201.35`; the engine mirrors this, parameterised on the `RateSet`.
- **Profiles count:** the prototype ships **19** profiles (not the documented 16 — adds `retail`,
  `apprentice`); ported verbatim (follow-the-source).

## Cross-refs
`src/engine/rates/fy2026.ts` (canonical) · `reference/FORMULAS.md` (oracle) ·
[decisions.md](./decisions.md) · [tech-debt.md](./tech-debt.md) · [handover.md](./handover.md) ·
[../PRE-LIVE-SETTINGS.md](../PRE-LIVE-SETTINGS.md) §4 (sign-off gate).
