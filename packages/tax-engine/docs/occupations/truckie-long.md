# Long-haul truck drivers (line haul / interstate) — deductions FY2025-26

## Who this covers

Employee drivers who **sleep away from home** on line-haul or interstate runs. Worksheet profile:
[`truckie_long`](../../src/engine/profiles/truckie-long.ts) — the app's default (initially active)
occupation. Home-daily drivers use [truckie-local.md](truckie-local.md) instead.

## What you can claim

### D1 — Car, ute or truck (a block per vehicle)

This is for **your own vehicle** used for work (the employer's prime mover is not yours to claim).
Two methods (`calc/d1-car.ts`), one block per vehicle:

- **Cents per km:** `min(km, 5,000) × $0.88` — capped at 5,000 work km by law, so the ceiling is
  **$4,400** per vehicle per year.
- **Logbook:** `(itemised running costs + decline in value) × work-use %`, where work-use % is
  work km ÷ total km. Decline in value is prime-cost over **8 years** with the purchase price
  capped at the **$69,674** car cost limit — i.e. at most **$8,709.25/yr** of decline
  (`fy2026.ts` `carCostLimit / carEffectiveLifeYears`).

The worksheet defaults to **Logbook** — "Logbook almost always beats cents-per-km for a truckie"
(profile `vehicleMethodNote`). Running-cost items include fuel (with a litres-per-100km
estimator), rego, insurance, servicing, and a loan-**interest** estimator (interest only, never
principal). Car wash and vehicle-improvement sections feed the same block; improvements are
depreciated, not expensed.

### D2 — Travel, accommodation & meals (the big one)

The worksheet models a **typical 14-day trip loop** (`d2Variant: 'full'`), annualised by the
number of trips per year. The meal engine (`calc/d2-travel.ts` `mealsFortnight`) applies three
nested caps, all from `fy2026.ts`:

1. **Per meal, per day** — each meal entry is clamped to the TD 2025/4 breakdown:

   | Breakfast | Lunch | Dinner | Incidentals |
   |---|---|---|---|
   | $34.75 | $39.10 | $66.65 | $24.50 |

2. **Per day** — the day total is clamped to the daily limit: **$165.00**, or **$201.35** when
   income is at/above the **$148,250** high-income threshold. (The four per-meal caps sum exactly
   to $165.00; in the high-income band each cap is scaled by `201.35 / 165` and rounded to cents —
   an open ruling documented in [../ato-rates.md](../ato-rates.md).)
3. **Per fortnight** — the 14-day total is clamped to `days actually worked × daily limit`, then
   multiplied by the number of trips in the year.

Accommodation is `nights × rate` as an estimate, or a **receipted total** which overrides the
estimate. Tolls are `(toll to work + toll home) × round trips`; parking and other travel costs are
simple row sums.

### D3 — Protective uniform + laundry

Clothing items are `quantity × cost per item` (hi-vis, steel-caps and other protective gear).
Home laundry is a flat **$3.00/week × weeks worked** (`homeLaundryPerWeek`); on-the-road
laundromat outlays are itemised `quantity × cost per use`.

### D4 — Self-education

A block per course (fees, materials, exams, device decline) plus study-from-home hours at the
**$0.70/hr** electricity rate. A block claims $0 until a course name is entered
(`calc/d4-selfeducation.ts`).

### D5 — Other work expenses

- **Overtime meals** (eligible: `overtimeMealEligible: true`): without receipts,
  `days × min(average cost, $38.65)` — the receiptless cap is **$38.65**
  (`overtimeMealNoReceiptMax`, deliberately *not* 37.65); with receipts, the receipted total.
  Overtime days derive from `(weeks at job − full weeks off) × OT days/week − days off`.
- **Phone/internet:** `cost per month × months × work-use %` (weekly work hours ÷ total hours).
- **Home office:** documented hours × **$0.70/hr** (electricity rate).
- Equipment, licences, union fees: row sums.

## What you can't claim / gotchas

- The **truck itself** — it's the employer's asset. D1 is for your own car/ute only.
- **Meals without sleeping away**: the 14-day meal loop assumes overnight travel. Home-daily work
  belongs on the `truckie_local` worksheet.
- Loan **principal** repayments (interest only), fines, ordinary commuting, anything reimbursed.
- Every meal figure is a **cap on what you actually spent**, not an automatic entitlement.

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$100,000** | **$40,000 – $55,000** | $47,500 |

The highest benchmark of all 19 profiles (`truckie-long.ts` `benchmarks`).

## In the worksheet

Profile id **`truckie_long`** (group "Transport & Logistics"; also mapped from the FIFO/DIDO
picker groups). Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14. Source:
[`src/engine/profiles/truckie-long.ts`](../../src/engine/profiles/truckie-long.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
