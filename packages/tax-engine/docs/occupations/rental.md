# Rental property owners — deductions FY2025-26

## Who this covers

Individuals with an investment property. Worksheet profile:
[`rental`](../../src/engine/profiles/rental.ts) — a **custom schedule** (`custom: 'rental'`), not
the standard D1–D14 accordion. It has a single cheat-sheet row, `RENTAL`, and no D5/home-office
section at all. The net total maps straight into the cheat sheet:

```
RENTAL = Σ operating expenses + (build cost × 2.5%) + plant & equipment decline
```

(`calc/cheatsheet.ts` `rentalTotal`.)

## What you can claim

### Operating expenses (row sums)

The ten `RENTAL_OPERATING_ITEMS` rows, each with its own inline help in the worksheet:

| Item | Worksheet help note |
|---|---|
| Advertising for tenants | portal fees, local signs |
| Body corporate fees / strata levies | |
| Council rates | |
| Water charges (landlord-paid) | |
| Property management / agent fees | commission + letting fees |
| Landlord insurance | building, contents, rent-default |
| **Interest on loans** | Interest component ONLY — do NOT enter principal repayments |
| Repairs & maintenance | walls, plumbing, electrical, lawns, locks |
| Pest control | inspections & treatment |
| Legal & accounting fees | tenancy agreements, property accounts |

### Capital works — 2.5% a year

Structural build cost × **2.5%/yr flat** (`capitalWorksRate: 0.025`, Division 43;
`calc/depreciation.ts` `capitalWorks`). The worksheet asks for the **original structural build
cost**, not the purchase price of the property.

### Plant & equipment decline

A manual annual figure for depreciating assets in the property (ovens, carpets, blinds —
prototype's `rent_plant` field), entered from a depreciation schedule and added to the total
as-is. For individual assets the engine's prime-cost helper prorates a mid-year purchase by
`(cost ÷ effective life) × days held ÷ 365` (`assetDeclineProrated`).

## What you can't claim / gotchas

- **Loan principal** — the single most-flagged mistake; the worksheet's lead text and the
  loan-interest row's help both repeat it. Interest only.
- The purchase price and stamp duty (capital, not deductible against rent); repairs that are
  really **improvements** (those are capital works or depreciating assets, not the repairs row).
- Water/rates the **tenant** pays; expenses for periods the property genuinely wasn't available
  for rent.

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **No fixed maximum** | **$10,000 – $20,000** | $15,000 |

`benchmarks.max: null` — "No fixed maximum — driven by your property holdings" (`rental.ts`).

## In the worksheet

Profile id **`rental`** (group "Property & Giving"). Custom layout; cheat-sheet row: **RENTAL**
only. Overtime meals and home office are off. Source:
[`src/engine/profiles/rental.ts`](../../src/engine/profiles/rental.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
