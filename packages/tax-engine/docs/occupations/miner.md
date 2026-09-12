# Mine-site employees (FIFO / DIDO) — deductions FY2025-26

## Who this covers

Mine-site workers, including fly-in fly-out and drive-in drive-out rosters. Worksheet profile:
[`miner`](../../src/engine/profiles/miner.ts). **FIFO/DIDO mapping note:** the occupation picker's
"FIFO (Fly-In Fly-Out)" and "DIDO (Drive-In Drive-Out)" groups are not separate worksheets — they
map onto the same base profiles (`truckie_long`, `truckie_local`, `tradie`, `miner`, `equipop`;
`profiles/index.ts` `OCCUPATION_GROUPS`). Equipment operators on site may fit `equipop` instead.

## What you can claim

### D1 — Car (FIFO airport trips with bulky gear)

Home-to-airport trips only count **when carrying bulky gear** — the profile's `minerCar` help box
and `vehicleMethodNote` both say so, and the default method is **Cents per km** (the trips are
occasional): `min(km, 5,000) × $0.88`, ceiling **$4,400**. Logbook remains available:
`(itemised running + decline) × work-use %`, decline prime-cost over **8 years** with the
**$69,674** cost cap (max **$8,709.25/yr**).

### D2 — Travel (FIFO transit only)

The `transit` variant covers **out-of-pocket transit accommodation and meals** — the missed-flight
motel, the self-funded transit leg. Estimates: accommodation `nights × rate` (or receipted total),
meals under the standard caps (per-meal $34.75 / $39.10 / $66.65 / $24.50 incidentals; daily
**$165.00**, **$201.35** at/above **$148,250** income), tolls `(to work + home) × round trips`.

### D3 — Site-mandatory safety uniform + camp laundry

`quantity × cost per item` over `MINER_CLOTHING_ITEMS`: fire-retardant hi-vis shirts and trousers,
steel-cap/metatarsal boots, rigger gloves, clear and tinted anti-fog safety glasses, hard-hat
accessories, headlamps. Camp laundry (`MINER_LAUNDRY`): commercial camp machines and industrial
fabric softener (red dirt / grease) at `quantity × cost per use`; home laundry **$3.00/week**.

### D4 — Mining tickets & machinery certifications

Tickets, machinery certifications and safety training connected to current duties — a block per
course: itemised outlays + study-from-home hours × **$0.70/hr**; a block claims $0 until named.

### D5 — Tools & operational gear

`MINER_EQUIPMENT_ITEMS` rows: socket sets & specialised wrenches, multi-meters, high-powered site
torches, personal UHF radios, heavy-duty FIFO gear bags, lock-out/tag-out padlocks, night-shift
thermals, hydration packs, union & professional dues. Plus:

- **Overtime meals** (eligible): receiptless `days × min(average cost, $38.65)`.
- **Phone/internet** work-use %; **home office** hours × **$0.70/hr**.

## What you can't claim / gotchas

- **Camp-provided meals & accommodation** — the profile's lead text says it up front: they cost
  you nothing, so there is nothing to claim. D2 is strictly the out-of-pocket transit slice.
- The home↔site commute itself; being FIFO doesn't convert it. Only the bulky-gear airport runs
  (D1) and self-funded transit costs (D2) enter the worksheet.
- Conventional clothing, employer-supplied PPE, reimbursed costs, fines.

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$43,000** | **$32,000** | $32,000 |

(`miner.ts` `benchmarks`.)

## In the worksheet

Profile id **`miner`** (group "Trades & Industrial"; also mapped from the FIFO and DIDO picker
groups). Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14. Source:
[`src/engine/profiles/miner.ts`](../../src/engine/profiles/miner.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
