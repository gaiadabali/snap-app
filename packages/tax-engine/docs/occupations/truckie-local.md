# Local truck drivers (home daily) — deductions FY2025-26

## Who this covers

Employee drivers who are **home each night** — metro and regional delivery, home-daily linehaul
legs. Worksheet profile: [`truckie_local`](../../src/engine/profiles/truckie-local.ts). Drivers
who sleep away from home should use [truckie-long.md](truckie-long.md) — the away-from-home meal
loop is the main thing that separates the two.

## What you can claim

### D1 — Personal car used for work errands

Not the truck (employer's asset) — your own car for depot runs, yard moves and work errands.
Methods per `calc/d1-car.ts`:

- **Cents per km:** `min(km, 5,000) × $0.88` → ceiling **$4,400** per vehicle.
- **Logbook:** `(itemised running costs + decline in value) × work-use %`; decline is prime-cost
  over **8 years**, purchase price capped at **$69,674** (max **$8,709.25/yr**).

Default method is **Logbook** — "usually beats cents-per-km if you keep good records"
(`vehicleMethodNote`). A `localCar` help box in the worksheet explains what counts as a work
errand versus commuting.

### D2 — Travel, accommodation & meals

Same full engine as long-haul (`d2Variant: 'full'`): occasional overnight trips use the per-meal
caps ($34.75 / $39.10 / $66.65 / $24.50 incidentals), the **$165.00** daily limit (**$201.35**
at/above **$148,250** income), accommodation `nights × rate` or receipted total, and tolls
`(to work + home) × round trips`. For a genuinely home-daily year this section mostly carries
**tolls and the odd overnight**, not a running meal claim.

### D3 — Hi-vis workwear, safety gear & laundry

Itemised `quantity × cost per item` from the local-driver clothing list
(`LOCAL_CLOTHING_ITEMS`): logo hi-vis shirts and jackets, heavy-duty work pants and shorts,
steel-cap boots, anti-slip socks, rigging gloves, UV sunglasses, wide-brim hi-vis hat. Laundry:

- **Home laundry:** flat **$3.00/week × weeks worked**.
- **Laundromat outlays (grease & oil stains):** `quantity × cost per use` — laundromat tokens,
  heavy-duty powder, degreaser (`LOCAL_TRAVEL_LAUNDRY`).

### D4 — Licence upgrades, tickets & course fees

MC/HC upgrades, dangerous-goods and other tickets — one block per course, itemised outlays plus
study-from-home hours at **$0.70/hr**. Blocks claim $0 until named (`calc/d4-selfeducation.ts`).

### D5 — Other work expenses

- **Overtime meals** (eligible): receiptless `days × min(average cost, $38.65)`; receipted =
  receipts total. Days derive from weeks worked × OT days/week minus days off (`calc/d5-other.ts`).
- **Phone/internet:** work-use % of the plan; **home office** hours × **$0.70/hr**.
- The `LOCAL_EQUIPMENT_ITEMS` list: phone handsets & accessories, PPE (wear/wet/sun/injury/other),
  truck maintenance supplies, tools, licences & registrations, logbooks & stationery, union and
  drivers' association fees — all simple row sums.

## What you can't claim / gotchas

- **Overnight-style meal claims while home each night** — the away-from-home loop isn't yours.
  Overtime meals under an allowance (D5, $38.65 receiptless cap) are the local driver's meal rule.
- The truck itself, fines, plain everyday clothing, the normal home↔depot commute, reimbursed costs.
- Loan **interest** only on any car finance — never principal.

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$43,000** | **$33,000** | $33,000 |

(`truckie-local.ts` `benchmarks`.)

## In the worksheet

Profile id **`truckie_local`** (group "Transport & Logistics"; also mapped from FIFO/DIDO groups).
Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14. Source:
[`src/engine/profiles/truckie-local.ts`](../../src/engine/profiles/truckie-local.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
