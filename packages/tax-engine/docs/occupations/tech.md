# IT & tech professionals — deductions FY2025-26

## Who this covers

Developers, sysadmins, analysts, and other tech workers — largely remote or hybrid. Worksheet
profile: [`tech`](../../src/engine/profiles/tech.ts). The profile's own framing: home-office
hours, certifications and tech equipment are the big claims — **everyday casualwear is not
deductible**.

## What you can claim

### D1 — Occasional client-site driving

The home↔office commute is private; occasional client-site or between-office driving counts
(`techCar` help box). Default method is **Cents per km**: `min(km, 5,000) × $0.88`, ceiling
**$4,400**. Logbook remains available for heavy work use: `(itemised running + decline) ×
work-use %`, decline prime-cost over **8 years**, cost capped at **$69,674** (max **$8,709.25/yr**).

### D2 — Travel

None. The tech profile has **no D2 category at all** (`d2: 'none'` in the prototype — the
accordion and its cheat row are skipped).

### D3 — Clothing: BLOCKED

The tech profile is the **only one with a blocked D3** (`blocked: true`, `tech.ts`). The
worksheet shows the category with this notice instead of inputs, and the engine returns $0 for
D3 even if inputs are somehow passed (`calc/cheatsheet.ts` `d3Total`):

> Tech-industry standard casualwear (jeans, t-shirts, hoodies) is **100% non-deductible** under
> ATO rules, even in an office or corporate environment. Only compulsory logo uniforms or
> certified protective items qualify, which generally do not apply here.

### D4 — Certifications, bootcamps & conferences

Certifications, bootcamps and conferences connected to the current role — a block per course:
itemised outlays (fees, materials, exams, device decline) plus study-from-home hours ×
**$0.70/hr**. A block claims $0 until it's given a course name.

### D5 — Tech equipment, subscriptions & fees

`TECH_EQUIPMENT_ITEMS` rows: laptop/MacBook for work duties, mechanical keyboard & ergonomic
mouse, multi-monitor setup, webcam & noise-cancelling headset, cloud subscriptions & developer
tool licences, code editors / specialised software, un-reimbursed VPN/security access,
professional association fees. Plus:

- **Home office — remote work hours**: total documented hours × **$0.70/hr** (electricity rate).
  Usually the headline claim for remote tech workers.
- **Phone/internet**: `cost per month × months × work-use %`.
- **No overtime meals** (`overtimeMealEligible: false`).

## What you can't claim / gotchas

- **Any casualwear** — the blocked D3 above is the differentiating rule of this profile.
- The commute; employer-reimbursed equipment and subscriptions; personal-use share of devices
  and internet (only the work-use percentage counts).
- Equipment above the immediate-deduction threshold declines over its effective life, prorated
  by days held ÷ 365 for mid-year purchases (`calc/depreciation.ts`).

## Benchmark box

| Benchmark max | Common claim | Midpoint |
|---|---|---|
| **$24,000** | **$15,500** | $15,500 |

(`tech.ts` `benchmarks`.)

## In the worksheet

Profile id **`tech`** (group "Office & Professional"). Cheat-sheet rows: **D1 D4 D5 D9 D10 D12
D14** — no D2 (variant `none`) and no D3 row (shown blocked, excluded from the cheat sheet;
explicit list at `tech.ts` `cheatRows`). Source:
[`src/engine/profiles/tech.ts`](../../src/engine/profiles/tech.ts).

---
General information only — not tax or financial advice. Rates: FY2025-26 (TD 2025/4) — verify annually per [../ato-rates.md](../ato-rates.md).
