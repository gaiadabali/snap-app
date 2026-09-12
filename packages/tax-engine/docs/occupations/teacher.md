# Teachers & educators — deductions FY2025-26

## Who this covers

School teachers and educators — classroom, specialist and trade teachers. Worksheet profile:
[`teacher`](../../src/engine/profiles/teacher.ts).

## What you can claim

### D1 — Excursions & between-campus driving

The home↔school commute is private; **excursion and between-campus driving is claimable**
(`teacherCar` help box). Default method is **Cents per km** — suited to occasional trips:
`min(km, 5,000) × $0.88`, ceiling **$4,400**. Logbook is available:
`(itemised running + decline) × work-use %`, decline prime-cost over **8 years** with the
**$69,674** cost cap (max **$8,709.25/yr**).

### D2 — Excursions & camps

The `business` travel variant: **out-of-pocket** excursion travel, meals and entry fees. Overnight
camps use the standard engine — accommodation `nights × rate` or receipted total, meals capped
per-meal at $34.75 / $39.10 / $66.65 (+$24.50 incidentals) and per-day at **$165.00**
(**$201.35** at/above **$148,250** income).

### D3 — Sun protection & specialised protective attire

No general clothing claim — the list (`TEACHER_CLOTHING_ITEMS`) is deliberately narrow:
wide-brim hats for yard duty and carnivals, sunscreen for outdoor supervision, UV sunglasses,
art/science smocks, lab coats, and heavy-duty clothing for metal/wood trade teachers — all
`quantity × cost per item`, plus home laundry at **$3.00/week × weeks worked**.

### D4 — Professional development & training

PD courses and training connected to current teaching — a block per course: fees, materials,
exams and device decline, plus study-from-home hours × **$0.70/hr**. Unnamed blocks claim $0.

### D5 — Classroom supplies, devices & fees

`TEACHER_EQUIPMENT_ITEMS` rows: classroom supplies (prizes, stickers, posters, art), reference
books & teaching resources, tissues/hand sanitiser/grading pens, **depreciation on a personal
laptop/iPad/printer**, teaching association fees, union memberships (AEU etc.). Plus:

- **Home office — marking & lesson prep** (the profile's own D5 title): documented hours ×
  **$0.70/hr**. This is typically a teacher's biggest D5 line.
- **Phone/internet** work-use %.
- **No overtime meals** — `overtimeMealEligible: false` in the code (`teacher.ts`, mirroring
  `ws.otMeals: false` in the prototype). Teachers aren't on the overtime-allowance whitelist, so
  the worksheet never shows the $38.65 receiptless claim.

## What you can't claim / gotchas

- The daily commute; conventional clothing (only the protective/sun items above).
- Anything the school reimburses or supplies; costs of student gifts beyond what you spent
  yourself; childcare.
- A device used partly personally is claimed by work-use portion via depreciation, not at full
  cost. Mid-year purchases prorate by days held ÷ 365 (`calc/depreciation.ts`).

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$22,000** | **$14,000** | $14,000 |

(`teacher.ts` `benchmarks`.)

## In the worksheet

Profile id **`teacher`** (group "Education"). Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14.
Source: [`src/engine/profiles/teacher.ts`](../../src/engine/profiles/teacher.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
