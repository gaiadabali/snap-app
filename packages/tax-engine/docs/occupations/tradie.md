# Tradies — deductions FY2025-26

## Who this covers

Employed tradespeople — chippies, sparkies, plumbers, concreters and site trades. Worksheet
profile: [`tradie`](../../src/engine/profiles/tradie.ts). Apprentices have their own cut-down
profile (`apprentice` — no published benchmarks, OT meals off); site-based operators may fit
`equipop`, and mine-site trades [miner.md](miner.md).

## What you can claim

### D1 — Vehicle (the bulky-tools rule)

Because a tradie carries **bulky tools the employer can't securely store**, home-to-site travel is
generally claimable — the profile's lead text and `tradieCar` help box carry this framing, and the
default method is **Logbook** ("carrying bulky tools makes home-to-site travel claimable — logbook
usually wins", `vehicleMethodNote`). Formulas (`calc/d1-car.ts`):

- **Cents per km:** `min(km, 5,000) × $0.88` → ceiling **$4,400**.
- **Logbook:** `(itemised running + decline in value) × work km ÷ total km`; decline is
  prime-cost over **8 years**, cost capped at **$69,674** (max **$8,709.25/yr**).

Tradie-specific D1 sections: **ute/van wash & cabin organisation** (a 24-item list from seat
covers to pressure cleaners) and **vehicle modifications (last 8 years)** — tool canopy, ladder
racks, shelving, dual-battery, tow bar — depreciated as improvements, not expensed.

### D2 — Travel (detailed expenses list)

The `tradiedetailed` variant: away-from-home accommodation, equipment, bedding, clothing and
tolls. Meals on overnight work travel follow the same engine caps as everyone else — per-meal
$34.75 / $39.10 / $66.65 / $24.50, daily **$165.00** (**$201.35** at/above $148,250 income).

### D3 — Protective & safety gear + laundry

`quantity × cost per item` over `TRADIE_CLOTHING_ITEMS`: steel-cap boots (plus laces and dubbin),
logo/fluoro hi-vis, canvas trousers, work shorts, UV-rated safety sunnies, hard hats, knee pads,
respirators. Home laundry **$3.00/week × weeks worked**; laundromat outlays for oil & concrete
stains are `quantity × cost per use`.

### D4 — Tickets, certifications & licence renewals

White card, working-at-heights, EWP and trade certificate renewals — a block per course
(itemised outlays + study hours × **$0.70/hr**; unnamed blocks claim $0).

### D5 — Tools & equipment (the two-level breakdown)

The tradie profile is the **only one with a two-level D5** (`equipmentBreakdown:
TRADIE_D5_CATS`). Ten top-level categories each expand into an itemised list:

| Category | Examples from the item list |
|---|---|
| PPE — wear | hi-vis singlets/vests/jackets, gloves, gaiters |
| PPE — wet protection | raincoats, gumboots, wet-weather overalls |
| PPE — sun protection | sun hat, hard-hat brim, sunscreen, zinc, cooly vest |
| PPE — injury supports & guards | safety glasses, back/knee supports, ear muffs |
| PPE — other | anti-chaff cream, insect repellent, RAT tests, Solvol |
| Tools | rattle gun, sockets, spanners, drills, saws, straps |
| Other work equipment | ladder, voltmeter, esky, dash cam, laptop, Wi-Fi dongle |
| Licences & registrations | trade rego/certificates, forklift licence, MSIC, white card |
| Stationery | pens, notepads, calculator |
| Union fees | union membership |

Plus the flat `TRADIE_EQUIPMENT_ITEMS` rows (power tools, mixers & laser levels, hand tools,
tool storage, consumables, test & tag fees, CFMEU/ETU union fees). Everything sums as rows;
**overtime meals** (eligible) cap at **$38.65**/day receiptless; **home office** at **$0.70/hr**.

## What you can't claim / gotchas

- **Conventional clothing** — jeans, drill shirts, everyday boots — even if only worn on site.
  Only the protective/occupation-specific items in the D3 lists qualify.
- The bulky-tools rule needs to actually hold (no secure site storage) before home↔site km count.
- Tools the employer supplies or reimburses; fines; loan principal (interest only).
- Assets over the immediate-deduction threshold decline over their effective life — a mid-year
  purchase prorates by days held ÷ 365 (`calc/depreciation.ts` `assetDeclineProrated`).

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$43,000** | **$31,000** | $31,000 |

(`tradie.ts` `benchmarks`.) Apprentices: no benchmark published (`apprentice.ts` `benchmarks: null`).

## In the worksheet

Profile id **`tradie`** (group "Trades & Industrial"; also mapped from FIFO/DIDO groups).
Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14. Source:
[`src/engine/profiles/tradie.ts`](../../src/engine/profiles/tradie.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
