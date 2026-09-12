# Nurses & midwives — deductions FY2025-26

## Who this covers

Employed nurses and midwives — hospital, aged-care, agency and community. Worksheet profile:
[`nurse`](../../src/engine/profiles/nurse.ts). Support workers and direct carers have their own
profile (`carer`, "Health & Care" group).

## What you can claim

### D1 — Mid-shift & on-call driving

Driving home to your regular shift is private; **mid-shift hospital-to-hospital moves and on-call
call-outs are claimable** (profile lead + `nurseCar` help box). Default method is **Cents per km**
— it suits occasional driving: `min(km, 5,000) × $0.88`, ceiling **$4,400**. Logbook is available
where a car is used heavily: `(itemised running + decline) × work-use %`, decline prime-cost over
**8 years**, cost capped at **$69,674** (max **$8,709.25/yr**).

### D2 — Tolls, parking & overnights

The `nurse` travel variant: tolls `(to work + home) × round trips`, client/hospital parking as row
sums, and occasional overnight stays — accommodation `nights × rate` or receipted total, meals
under the standard caps (per-meal $34.75 / $39.10 / $66.65 / $24.50; daily **$165.00**, or
**$201.35** at/above **$148,250** income).

### D3 — Footwear, uniforms & laundry

`quantity × cost per item` over `NURSE_CLOTHING_ITEMS`: nursing shoes and work-only non-slip
shoes, shoe inserts (gels/orthotics/odour eaters), uniforms, work dresses/pants/shirts, tailoring
and dry cleaning. Home laundry **$3.00/week × weeks worked**; laundry additives (antibacterial
softener, fluid stain remover) at `quantity × cost per use`.

### D4 — AHPRA registration, CPD & specialisation tickets

Registration **renewal**, CPD points and specialisation courses connected to the current role —
a block per course: itemised outlays plus study-from-home hours × **$0.70/hr**. A block claims $0
until a course name is entered.

### D5 — Medical tools, consumables & fees

`NURSE_EQUIPMENT_ITEMS` rows: stethoscope, diagnostic penlights, **fob watch** (wristwatches are
banned in sterile areas — the classic exception to the no-watch rule), surgical scissors, tape
holders, hand creams for sanitiser-induced dermatitis, face-shield replacements, nursing union
dues (ANMF etc.). Plus:

- **Overtime meals** (eligible — the profile notes "award overtime shifts with a meal
  allowance"): receiptless `days × min(average cost, $38.65)`; receipted = receipts total.
- **Phone/internet** work-use % (agency shift apps); **home office** hours × **$0.70/hr**.

## What you can't claim / gotchas

- The ordinary home↔shift commute — only mid-shift and on-call driving counts (D1 above).
- Conventional clothing and plain shoes, everyday grooming, meals on normal shifts,
  reimbursed costs.
- The **initial** registration that lets you enter the profession — D4 covers renewals and CPD
  connected to the job you already hold.

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$38,000** | **$24,000** | $24,000 |

(`nurse.ts` `benchmarks`.)

## In the worksheet

Profile id **`nurse`** (group "Health & Care"). Cheat-sheet rows: D1 D2 D3 D4 D5 D9 D10 D12 D14.
Source: [`src/engine/profiles/nurse.ts`](../../src/engine/profiles/nurse.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
