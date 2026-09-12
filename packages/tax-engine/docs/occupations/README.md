# Occupation deduction guides (FY2025-26)

Content source for **future occupation pages** and a **team reference** for what each worksheet
profile actually computes. Every figure is generated from the engine — canonical constants in
[`src/engine/rates/fy2026.ts`](../../src/engine/rates/fy2026.ts) (**FY2025-26, TD 2025/4**),
profile data in `src/engine/profiles/*.ts`, formulas in `src/engine/calc/*.ts`. Nothing here is
hand-invented; if a guide and the code disagree, the code wins and the guide has a bug.

> Rates change every income year. Re-verify per [../ato-rates.md](../ato-rates.md) before reusing
> any number. Open rulings (benchmark drift, high-income meal-cap scaling, proration) live in
> [../decisions.md](../decisions.md) — referenced, not restated, here.

## The guides

| Guide | Profile(s) covered |
|---|---|
| [truckie-long.md](truckie-long.md) | `truckie_long` — line-haul / interstate, sleeps away |
| [truckie-local.md](truckie-local.md) | `truckie_local` — home-daily drivers |
| [tradie.md](tradie.md) | `tradie` (apprentices noted) |
| [miner.md](miner.md) | `miner` — FIFO/DIDO site workers |
| [nurse.md](nurse.md) | `nurse` — nurses & midwives |
| [teacher.md](teacher.md) | `teacher` — teachers & educators |
| [tech.md](tech.md) | `tech` — IT & tech professionals |
| [rental.md](rental.md) | `rental` — rental property owners (custom schedule) |

## All 19 profiles at a glance

From `src/engine/profiles/*.ts` (registry: `profiles/index.ts` `PROFILES`). "Benchmark max /
common" is the profile's `benchmarks` object (`max` / `common` display range); "OT meals" is
`overtimeMealEligible`; "Home office" is `homeOfficeEnabled` + `homeOfficeRate` ($0.70/hr
electricity or $0.67/hr fixed — `fy2026.ts`).

| Profile id | Label | Benchmark max | Common claim | OT meals | Home office |
|---|---|---|---|---|---|
| `truckie_long` | Traveling Truckie (Line haul / Interstate) | $100,000 | $40,000–$55,000 | Yes | $0.70/hr |
| `truckie_local` | Local Truckie (Home daily) | $43,000 | $33,000 | Yes | $0.70/hr |
| `tradie` | Tradie | $43,000 | $31,000 | Yes | $0.70/hr |
| `miner` | Miner | $43,000 | $32,000 | Yes | $0.70/hr |
| `factory` | Factory Worker | $22,000 | $13,000 | Yes | $0.70/hr |
| `forklift` | Forklift Driver | $38,000 | $24,000 | Yes | $0.70/hr |
| `equipop` | Equipment Operator | $43,000 | $30,000 | Yes | $0.70/hr |
| `carer` | Carer (Disabled / Aged / Kids) | $36,000 | $21,000 | Yes | $0.70/hr |
| `award` | All Other Overtime & Award Occupations | $20,000 | $11,500 | Yes | $0.70/hr |
| `whitecollar` | All Other Professional & White-Collar Occupations | $24,000 | $15,500 | No | $0.70/hr |
| `sole` | Sole Trader (ABN under individual TFN) | $69,000 | $46,000 | No | $0.67/hr (fixed) |
| `rental` | Rental Property Owner | No fixed maximum | $10,000–$20,000 | No | Disabled (custom layout) |
| `tither` | Tither / Regular Donor | No fixed maximum | $6,000–$8,000 | No | Disabled (custom layout) |
| `nurse` | Nurse / Midwife | $38,000 | $24,000 | Yes | $0.70/hr |
| `teacher` | Teacher / Educator | $22,000 | $14,000 | No | $0.70/hr |
| `salesrep` | Sales Rep / Real Estate Agent | $39,000 | $26,000 | No | Disabled (`ws.homeOffice: false`) |
| `retail` | Retail & Hospitality Worker | $19,000 | $11,500 | No | $0.70/hr |
| `tech` | IT & Tech Professional | $24,000 | $15,500 | No | $0.70/hr |
| `apprentice` | Apprentice Tradie | — (no benchmark published) | — | No | $0.70/hr |

Notes traceable to the code:

- `apprentice` has `benchmarks: null` (no `data.js OCCUPATIONS` row) and is not reachable from the
  occupation picker (`group: null`) — figures deliberately not invented here.
- `retail` and `apprentice` declare overtime-meal notes in the prototype but are **not** in the
  `OT_OCCS` whitelist, so eligibility is forced off (`profiles/types.ts` comment, calc.js 1441-42).
- `rental` and `tither` are custom layouts (`custom: 'rental' | 'tither'`) with single cheat rows
  `RENTAL` and `D9` respectively; `tither` gates each donation row on a DGR checkbox
  (`calc/d9-d14.ts` `d9Donations`).
- FIFO and DIDO picker groups map onto the same base profiles (`truckie_long`, `truckie_local`,
  `tradie`, `miner`, `equipop`) — there is no dedicated FIFO worksheet (`profiles/index.ts`).
- The benchmark-drift question (FORMULAS.md vs data.js values for `whitecollar`/`award`) is an
  **open ruling** — engine tests assert the data.js values. See [../ato-rates.md](../ato-rates.md).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
