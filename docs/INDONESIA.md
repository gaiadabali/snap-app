# Indonesia: PPN, PPh, and what Indonesian paper can prove

**Date:** 2026-09-17 · **Status:** research, not a decision
**Answers:** "what would it take to make this app fully usable by an Indonesian
user, and can Indonesian receipts stand in for the Australian ones we cannot
get?"
**Does not answer:** whether we should do it. §11 lists options; none of them is
settled, and nothing below should be read as a plan of record.

Every factual claim carries its source. Where a source is weak or contradicts
another, §10 says so instead of picking one.

---

## 0. The two questions, separated

They are not the same question and conflating them is the main risk here.

1. **Product**: can an Indonesian sole trader get the value this app sells?
   §1–§6.
2. **Evidence**: can Indonesian paper substitute for `docs/GAPS.md` B1's
   Australian gold set? §9. This one is answerable today and mostly good news.

Question 2 does not require question 1. We can photograph Indonesian dockets and
learn real things about the reading engine without shipping a single Indonesian
feature. §9 is the part with immediate leverage.

---

## 1. The finding that should change the plan first

**Most Indonesian sole traders cannot deduct expenses at all.**

An individual with turnover under Rp 4.8 billion may elect the PP 23 regime:
**0.5% final income tax on gross monthly turnover**, with the first Rp 500
million of annual turnover exempt. Final means final — there is no expense
deduction, no depreciation, no worksheet. PP 20/2026 has just *narrowed* this
regime to individuals and single-shareholder PT Perorangan, removing it for most
corporate forms.

The README's opening sentence is "a BAS and deduction-compliance layer for
Australian sole traders and tradies." The direct Indonesian translation of that
customer — the individual tradie under Rp 4.8bn — is on a turnover tax where
**categorising an expense has zero tax effect.** `@snap/tax-engine` and its 217
golden tests have no Indonesian counterpart, and not because nobody has written
one: D1–D14 is a worksheet that does not exist in a jurisdiction with no
worksheet.

The Indonesian buyer for whom this software is worth money is a different person:
a **PKP** (VAT-registered enterprise) keeping books, crediting input VAT, and
substantiating expenses against a 22% corporate rate — plus the withholding
obligations in §6.3. That is a company with a bookkeeper, not a tradie with a
phone. Whether that customer is reachable through the same channel (accounting
practices) is a commercial question, not a technical one, and it is upstream of
everything else in this document.

---

## 2. PPN mechanics, and the invariant they break

### 2.1 The rate is 12% and the effective rate is 11%

UU HPP 7/2021 scheduled PPN to 12% from 1 January 2025. **PMK 131/2024** then set
the tax base for non-luxury supplies to a *DPP Nilai Lain* of **11/12 of the
selling price**, so:

```
PPN = 12% × (11/12 × price) = 11% × price
```

Luxury goods subject to PPnBM get the full 12% on the full price. Both are live
in 2026.

### 2.2 What that does to `gstFromInclusive`

On a tax-inclusive total, Australia's answer is exactly 1/11. Indonesia has two
answers and neither is 1/11:

| Jurisdiction | Inclusive multiplier | Tax inside the inclusive total |
|---|---|---|
| AU GST 10% | ×1.10 | `inclusive × 1/11` |
| **ID PPN standard** | ×1.11 | **`inclusive × 11/111`** |
| **ID PPN luxury 12%** | ×1.12 | **`inclusive × 3/28`** |

`packages/api-contract/src/money.ts:66` and `packages/db/src/money.ts:88` both
compute `(abs × 2 + 11) / 22`. That constant is the jurisdiction.

### 2.3 The invariant that actually breaks

This is the part worth reading twice, because it is the shape the README's "The
rule this project is built around" warns about — two correct things that nothing
checks the agreement of.

A faktur pajak prints the **DPP** (11/12 of price) and the **12%** rate. So for a
Rp 1,000,000 sale:

```
Harga jual (price)        1,000,000
DPP Nilai Lain (11/12)      916,667   <- printed on the faktur as the tax base
PPN 12% × DPP               110,000   <- printed as the tax
Total payable             1,110,000
```

Now note: `1,110,000 − 110,000 = 1,000,000`, which is **not** the printed DPP of
916,667.

In Australia `taxable_amount + tax_amount = inclusive_total` always holds, and
`apps/server/src/extraction/tax-subtotals.ts` relies on it directly —
`taxableAmount: money.subtract(taxableInclusive, gst)`. Under DPP Nilai Lain that
identity is false by construction. `document_tax_subtotals` stores BT-116
(taxable), BT-117 (tax) and BT-119 (rate); an Indonesian faktur populates them
such that BT-116 + BT-117 ≠ the payable, and a validator that derives the rate as
`tax ÷ taxable` gets 12 while one that derives it as `tax ÷ price` gets 11.

Both are right. Nothing currently knows they can differ. That is a real defect
waiting in the schema, not a formatting problem.

Checked rather than reasoned about — the two identities, run:

```
  DPP + PPN      1,026,666.67  != payable 1,110,000.00   <- the AU invariant fails
  payable - PPN  1,000,000.00  != printed DPP 916,666.67 <- what tax-subtotals.ts would emit
```

And for §2.2, on that same payable: `1/11` gives 100,909.09, `11/111` gives
110,000.00, which is the figure the faktur prints.

### 2.4 The mixed-rate wedge survives, and it is the good news

**PP 49/2022** exempts basic necessities from PPN: rice and paddy, maize, sago,
soybeans, table salt, meat, eggs, milk, fruit and vegetables (a Pasal 16B UU HPP
facility). A docket from an Indonesian supermarket therefore mixes PPN-exempt
fresh food with PPN-able packaged goods on one piece of paper — the **exact
structural counterpart** of the Australian GST/GST-free grocery docket that the
README calls "the one capability no competitor has."

So the flagship capability is not AU-specific. The per-line split, the
`document_tax_subtotals` table and the Peppol BG-23 modelling all transfer. The
rate arithmetic and the label mapping do not.

---

## 3. Identity: NPWP replaces ABN, and the checksum gets weaker

### 3.1 The format

Since PMK 112/2022 and fully in Coretax from 2025, the taxpayer number is **16
digits**:

- **Individual (WNI):** NPWP *is* the 16-digit NIK from the KTP.
- **Entity / non-WNI:** the old 15-digit NPWP with a leading `0`.
- **Branch:** a separate 22-digit **NITKU** (16-digit NPWP + 6-digit branch).

### 3.2 There is no mod-89 here

`abn_is_valid()` in `packages/db/migrations/0001_extensions_domains_enums.sql` is
an IMMUTABLE function backing a **generated column** on `tenants` and `parties`,
and `validators.ts:56` mirrors it. That is a genuinely strong control: a single
misread digit in an ABN is caught arithmetically, before it can become a
disallowed claim.

Indonesia does not give us an equal control:

- **NIK has no checksum at all.** It is 6 digits of region code, 6 of date of
  birth (with +40 added to the day for women), and a 4-digit serial. The only
  checks available are structural: does the region code exist, does the encoded
  date exist. That catches some misreads and not the common ones.
- The **legacy 15-digit NPWP** is widely described as carrying a check digit in
  position 9 over the first 8, on a Luhn mod-10. The best source found is a Perl
  module whose own wording is "it is *apparently* using Luhn." **Do not ship this
  as a gate on that evidence** — see §10.1.

The practical consequence: `supplier_abn_invalid` has no Indonesian equivalent of
the same strength, so the burden shifts onto the clearance check in §4.2, which
is a network call rather than arithmetic.

---

## 4. What makes a document claimable — and why the retail docket is not

This is where the product's centre of gravity moves.

### 4.1 Australia, for comparison

`validators.ts` §7 encodes it: the words "tax invoice", a supplier ABN, the GST
shown, and the buyer identified at $1,000 and above. All four are decidable from
the pixels. That is why the app works from a photograph alone.

### 4.2 Indonesia: the pixels are not sufficient

Input VAT (*Pajak Masukan*) is creditable only where the faktur pajak:

1. was issued by a **PKP**,
2. carries a valid **NSFP** and the buyer's NPWP,
3. was **e-signed and cleared by DJP through Coretax**, and
4. was **uploaded by the 20th of the month following issuance** — miss it and the
   buyer loses the credit (PER-11/PJ/2025).

Coretax launched 1 January 2025 and DJP clearance became a legal precondition for
validity from 31 December 2025. A cleared faktur reaches the buyer as a
**QR-coded PDF**.

Two structural consequences:

- **Validity is a server-side fact, not a document fact.** No amount of reading
  the image tells you whether DJP cleared it or whether the seller uploaded it in
  time. The honest Indonesian version of `is_tax_invoice` is a *clearance
  lookup*, and the QR code is the handle for it. The `claims_credit AND NOT
  is_tax_invoice => gst_unclaimable` logic in the BAS view
  (`packages/db/migrations/0006_ledger.sql:146`) has the right shape and the
  wrong input.
- **There is a deadline the buyer does not control.** A document that was valid
  when photographed can become uncreditable on the 21st. Nothing in the current
  model has a concept of a document whose status changes after capture.

### 4.3 The retail docket yields no credit at all

**PPN on a *faktur pajak pedagang eceran* — a cash-register slip, bon kontan,
kuitansi, karcis — is input VAT that the buyer cannot credit.**

PER-11/PJ/2025 made retail status depend on the transaction (a supply to a final
consumer) rather than on the seller's KLU business classification, and it lets
those sellers omit the buyer's identity and use their own serial numbering. The
same features that make the document easy to issue are what make it
uncreditable.

Read that against what this app is built to photograph. The supermarket docket,
the servo receipt, the hardware slip — in Australia each one is a GST credit. In
Indonesia each one is a **PPh expense substantiation and nothing more**. The
product's Indonesian claim is not "recover your input VAT from a photo of a
receipt"; it is "substantiate a deductible expense, and prove the withholding
behind it was done" (§6.3).

---

## 5. PB1 / PBJT: the Indonesian trap that looks exactly like VAT

Restaurant, hotel, parking and entertainment consumption is **not** subject to
PPN. It is subject to **PBJT** (colloquially **PB1**), a *regional* tax under UU
1/2022 HKPD at up to **10%**, collected by the local government, and DJP is
explicit that this object is PBJT rather than PPN. It appears on the receipt as a
separate line, frequently alongside a 5–10% **service charge** which is itself
part of the PBJT base.

So an Indonesian restaurant bill prints a 10% tax line that:

- is **not PPN**,
- is **never creditable as input VAT**,
- and sits one line away from where PPN would print, in the same position, at a
  rate a reader would recognise.

A model told "find the tax" will find it. A validator told "tax should be 11/111
of the inclusive total" will find that 10% of the pre-tax subtotal is close
enough to pass on small amounts. This is a **confident-wrong** failure mode of
exactly the kind `docs/OCR.md` and the `CONFIDENT_WRONG` scoring category exist
to catch, and it has no Australian analogue — there is no second 10% tax on an
Australian docket to confuse with GST.

It is also, for the same reason, one of the most valuable fixtures a corpus could
contain (§9.3).

---

## 6. Periods, calendar, retention, withholding

### 6.1 The calendar

| | AU | ID |
|---|---|---|
| Financial year | 1 Jul – 30 Jun | **1 Jan – 31 Dec** |
| VAT period | **Quarterly** BAS | **Monthly** SPT Masa PPN |
| VAT deadline | 28 days after quarter | end of the following month |

`tenants.financial_year_start_month` already exists and defaults to 7, so the
first row is a config change. The second row is not.

`quarterOf()` in `validators.ts:163` is not only used for reporting — it is the
**tie-breaker in the day/month ambiguity check**. The check deliberately stays
silent when both readings of `06/09/26` land in the same BAS quarter, on the
stated reasoning that stopping ~40% of documents to confirm a date teaches people
to tap through warnings. Under monthly periods, *every* ambiguous pair lands in a
different period by definition. Swapping quarters for months does not change a
constant; it changes how often the app interrupts a user, from "sometimes" to
"every time both numbers are ≤ 12."

### 6.2 Retention

UU KUP Pasal 28 ayat (11) requires books, records and the underlying documents to
be kept **10 years, in Indonesia**, aligned to the criminal-investigation
limitation period.

Three AU constants encode 5:

- `packages/db/migrations/0004_parties_documents.sql:81` — `retention_until` =
  issue date + 5 years
- `packages/db/migrations/0008_billing_usage.sql:32` — `retention_months` default
  60
- `validators.ts` `dateProblem()` — rejects anything older than **7 years** as
  implausible, reasoning explicitly from the five-year retention period

The third one is a behaviour change, not a config change: under a 10-year
obligation a genuinely 8-year-old document is a document a taxpayer is legally
required to still hold, and the validator would refuse it with
`date_implausible`.

*Note:* "in Indonesia" is a data-residency clause. Whether it binds a SaaS
processor holding the images is a legal question, not a research one, and it is
in §10.4.

### 6.3 Withholding is the Indonesian compliance wedge

An Indonesian expense can be disallowed in audit **because the withholding tax on
the payment was never withheld or remitted**, even where the expense itself is
genuine. PPh 23 (services, rent, royalties), PPh 21 (individuals), PPh 4(2)
(final, e.g. construction, land rent).

This has no Australian counterpart and it is arguably a *better* product hook
than the deduction engine: it is deterministic, it is per-document, and the
failure is expensive and discovered late. A document reader that knows a payment
to a service vendor should have carried PPh 23 is telling the user something they
cannot see on the receipt, which is the same category of value as the per-line
GST split.

---

## 7. Extraction hazards specific to Indonesian paper

Everything above is law. This section is about pixels, and it is where the
immediate engineering risk sits.

### 7.1 The decimal separator is inverted — this is the dangerous one

Indonesian convention is **`.` for thousands and `,` for decimals**:
`Rp 1.234.567,89`. Rupiah amounts routinely print with no decimal part at all, so
a docket shows `15.000` meaning **fifteen thousand**.

Now trace it. `prompt.ts` RULE 4 says "plain decimal strings, no currency symbol,
no thousands separator." A model handed an Indonesian docket can reasonably
return `"15.000"`. `toUnits()` in both money modules matches
`^(-?)(\d+)(?:\.(\d*))?$`.

Run against that regex, the two Indonesian forms behave differently, and the
difference is the finding:

```
  15.000         -> 15.0000                 <- ACCEPTED. Off by a thousand.
  1.234.567,89   -> REJECTED (not a decimal amount)
  15000          -> 15000.0000
```

The fully-formatted form throws, which is the safe outcome. The **no-decimal
form** — which is how rupiah is normally printed, because there are no cents —
parses silently as fifteen, in a codebase whose fourth founding principle is
"money is a decimal string, end to end."

And it passes the existing checks. If the tax was misread the same way, the
arithmetic stays internally consistent: `1/11` of a wrong number is still
`1/11`, so `gst_arithmetic` stays quiet and `lines_do_not_balance` stays quiet.
Nothing in the pipeline has a view on magnitude.

This is the single highest-severity finding in this document, and it is worth
noting that it is reachable *today*, without any Indonesian feature work, by any
Australian user who photographs a receipt from a trip.

### 7.2 Tolerances are written in dollars

`ROUNDING_TOLERANCE = 0.05` (`validators.ts:39`) and the `0.011` GST drift
threshold are literal currency amounts. Five rupiah is not five cents — it is
roughly a two-hundredth of it. Rupiah is rounded to whole units and often to the
nearest Rp 100, so the correct Indonesian tolerance is *larger* in absolute terms
and *smaller* in relative terms. A tolerance has to be expressed per currency, not
as a number in the source.

### 7.3 Vocabulary and presentation

| Concept | AU token | ID tokens |
|---|---|---|
| Total | `TOTAL` | `TOTAL`, `JUMLAH`, `TOTAL BAYAR`, `GRAND TOTAL` |
| Subtotal | `SUBTOTAL` | `SUBTOTAL`, `SUB TOTAL` |
| Tax | `GST` | `PPN`, `PPN 11%`, `PPN 12%`, `DPP`, **`PB1`**, `PAJAK` |
| Tax invoice | `TAX INVOICE` | `FAKTUR PAJAK` |
| Cash / change | `CASH` / `CHANGE` | `TUNAI` / `KEMBALI`, `KEMBALIAN` |
| Discount | `DISCOUNT` | `DISKON`, `POTONGAN` |
| Quantity | `QTY` | `QTY`, `JML`, `BANYAK` |
| Tax id | `ABN` | `NPWP`, `NITKU` |

Dates are **day-first**, same as Australia — the one thing that transfers
unchanged. But month abbreviations differ where it matters: `Mei`, `Agu`/`Ags`,
`Okt`, `Des`. Bali and Jakarta receipts are frequently bilingual or English-only.

Script is Latin, so PP-OCRv5's recognition model applies unchanged. That is why
§9 works at all.

### 7.4 User-facing formatting

`aud()` (`validators.ts:218`) hardcodes `$` and `en-AU`. Every finding message a
user reads goes through it.

---

## 8. Inventory: where Australia is hardcoded

Facts from the code as it stands on `feat/web-3d-spike`. Not a work plan — a map
of what a second jurisdiction would have to touch, so the size of the question is
visible rather than guessed at.

| Location | Australian assumption |
|---|---|
| `api-contract/src/money.ts:66`, `db/src/money.ts:88` | `gstFromInclusive` = 1/11 |
| `api-contract/src/money.ts` `gstOnSale` | 10% on sale, rounded to the cent |
| `validators.ts:35–37` | $82.50 tax-invoice threshold, $1,000 buyer threshold |
| `validators.ts:39` | rounding tolerance as `0.05` dollars |
| `validators.ts:56` `abnIsValid` | ABN mod-89 |
| `validators.ts` `dateProblem` | 7-year window, from a 5-year retention rule |
| `validators.ts:163` `quarterOf` | Jul–Jun quarters; also the ambiguity tie-break |
| `validators.ts:218` `aud` | `$`, `en-AU` |
| `validators.ts` §6 | currency ≠ `AUD` is a warning |
| `validators.ts` §7 | "tax invoice" wording, supplier ABN, buyer ID ≥ $1,000 |
| `tax-subtotals.ts` | `RATE_STANDARD`, `taxable = inclusive − tax` (§2.3) |
| `prompt.ts` | "Australian receipts", DD/MM, 1/11, 11-digit ABN, $1,000 |
| `0001_extensions_domains_enums.sql` | `abn_is_valid()` IMMUTABLE + generated columns |
| `0002_tenancy.sql` | `financial_year_start_month` 7, `simpler_bas`, `gst_basis` |
| `0004_parties_documents.sql:81` | `retention_until` = issue date + 5 years |
| `0005_accounts_tax_codes.sql` | 7 seeded tax codes at `10.0000` with BAS labels G1/G10/G11/1A/1B |
| `0006_ledger.sql:146` | BAS view keyed on `purchase_labels` / `sale_labels` |
| `@snap/tax-engine` | the entire D1–D14 engine, 217 golden tests |

The schema is in better shape than the code: `tenants.country`,
`tenants.base_currency`, `parties.country`, `country_code`, `currency_code` and
`financial_year_start_month` all already exist and default to AU rather than
assuming it. The seams are there. What is missing is anything that *reads* them —
`country` is currently a stored fact with no behaviour attached.

The last row is the one that does not have a seam and cannot be given one (§1).

---

## 9. The corpus: what Indonesian paper can and cannot prove

The question that has immediate leverage, and the reason this research was worth
doing now.

### 9.1 The constraint, restated

`docs/CORPUS.md` §0 is blunt about it: B1 wants ≥ 40 real Australian documents,
**the team is in Indonesia**, and the client cannot be scheduled. §3 already
classifies real-but-not-Australian paper as **Tier P** and already names CORD —
~11,000 real Indonesian receipts with line-item annotation under **CC-BY 4.0** —
as worth having.

So the framing "compensate AU receipts with Indonesian receipts" is not a new
idea against this repo. What this research adds is a sharper account of *what the
substitution buys*, and it is more than CORPUS.md claims.

### 9.2 What it buys, against CORPUS.md §1's three jobs

**Job 1 — exercise the harness: fully.** Nothing about `run.py` → `scoring.py` →
`results.md` cares about jurisdiction.

**Job 2 — develop and regression-test the code: fully, and better than
synthetic.** Real thermal print, real dropout, real curl, real glare — the exact
failure modes CORPUS.md §2 says a Gaussian blur does not reproduce. Latin script,
so the recognition model is the same one.

**Job 3 — support a claim about Australian paperwork: no. Unchanged.** Tier P
cannot become Tier R by being real. The §4 controls — `provenance.tier` required
with no default, `results.md` titled by the weakest tier, `corrections per 100`
and the calibration curve refusing to emit below Tier R — all still apply and all
still bind.

**And a fourth job CORPUS.md does not list, which is the actual prize:**

> **A second jurisdiction converts "the engine is AU-coupled" from an opinion
> into a failing test.**

Right now every item in §8 is invisible. There is one jurisdiction, so an
Australian constant and a universal constant are indistinguishable by
observation — which is precisely the "nothing checks the agreement between two
correct things" shape the README says cost this project six defects. A corpus
with `captured_in: "ID"` documents in it makes each one of those rows either a
parameter or a red test. That is the control, and it is cheap, and it does not
need the client.

### 9.3 The matched-pair shape

Pairing is what makes it evidence rather than an anecdote: for each AU archetype
B1 asks for, capture the Indonesian counterpart, so a difference in score is
attributable to the paper rather than to the document class.

| AU archetype (B1) | Indonesian counterpart | What the pair isolates |
|---|---|---|
| Mixed GST/GST-free grocery docket | Supermarket docket mixing PP 49/2022 exempt food with PPN-able goods | The flagship per-line split, in both jurisdictions (§2.4) |
| Fuel / servo | SPBU slip | Numeric-dense layout, unit price at 3dp |
| Hardware (Bunnings-shaped) | Building-supplies slip | Long line lists, item codes |
| Café | **Restaurant bill with PB1 + service charge** | **The confident-wrong tax-line trap (§5)** |
| Commercial tax invoice | **Cleared faktur pajak, QR-coded PDF** | DPP Nilai Lain (§2.3), NSFP, buyer NPWP |
| Multi-page PDF, total on page 2 | Multi-page faktur | Cross-page total assembly |
| Genuinely degraded photo | Same, on Indonesian thermal | Real dropout vs simulated blur |
| Handwritten annotation | Handwritten *kuitansi* | Handwriting, which is more common on ID paper |

The last column is the point. Each pair tests one structural property under two
tax regimes, and a property that holds under both is a property of the engine.

### 9.4 A gap in the existing control

CORPUS.md §4's `provenance` block has `tier` and `captured_in` as independent
fields. Nothing stops a document being recorded as `tier: "R"` with
`captured_in: "ID"`, or with `captured_in: null`. Given that the whole purpose of
§4 is that "nobody — including a future session with no memory of this
conversation — can produce a quotable accuracy number from data that cannot
support one," the two fields should be tied: **Tier R requires
`captured_in == "AU"`**, asserted at manifest load, alongside the existing
"missing tier is an error" rule.

Small, and exactly the class of control this repo already builds.

### 9.5 What it does not buy, stated so it cannot drift

- No claim about Australian reading accuracy.
- No calibration curve. Confidence calibration fitted on Indonesian paper and
  applied to Australian paper is the same failure CORPUS.md §2 identifies for
  synthetic data — *worse than no calibration*, because `auto_accepted` becomes a
  risk decision on a false risk model.
- No competitor comparison that names Australia.
- B1 does not close. It is unblocked around, not closed.

---

## 10. Open questions — do not build on these without checking

Listed because a research document that hides its weak sources is worse than no
document.

1. **The 15-digit NPWP check digit.** Best available source says "apparently
   Luhn." Needs verification before it becomes any kind of gate. **Check by:**
   collecting 50+ real NPWPs from Indonesian faktur pajak and testing the
   hypothesis; if it fails on even one, there is no checksum control and §3.2
   stands as written.
2. **NSFP length under PER-11/PJ/2025.** One low-quality source says the serial
   moved from 16 to 17 digits (2 transaction + 2 status + 13 serial); the
   e-invoicing compliance source describes the NSFP without giving a length.
   Resolve against PER-11/PJ/2025 itself before writing any format check.
3. **Coretax clearance lookup.** §4.2 assumes the QR code resolves to a
   verifiable DJP record. Whether there is a programmatic validation endpoint,
   what it costs, and whether it is open to a third party is unknown — and it is
   load-bearing for the whole Indonesian VAT story.
4. **UU KUP 28(11) "in Indonesia".** Whether the data-residency clause reaches a
   SaaS processor holding document images. Legal question.
5. **Retention vs. assessment.** 10 years for documents (§6.2) against the
   5-year assessment limitation in UU KUP Pasal 13 — worth confirming which drives
   `retention_until`. One search source asserted 30 years and was almost certainly
   conflating a different statute; it is not relied on here.
6. **PBJT rates vary by region.** Up to 10% is the national ceiling under UU
   1/2022; the actual rate is set by each regency. A validator cannot assume 10%.
7. **PP 20/2026's full scope.** It is nine months old and the sources found were
   advisory-firm summaries, not the regulation.

---

## 11. Options, none of them decided

Deliberately separated from everything above, and deliberately not ranked into a
plan. These are what the research makes available, not what it recommends.

**A. Evidence only.** Build the matched-pair Tier P corpus (§9.3), add the §9.4
assertion, fix §7.1 and §7.2 as plain defects. No Indonesian features. Closes a
real money-safety bug, unblocks lane B work, and commits to nothing.

**B. Evidence plus parameterisation.** A above, plus turning the §8 rows into a
jurisdiction record that `tenants.country` actually selects. The Indonesian
corpus becomes the test that the parameterisation is real, rather than a second
set of constants in a different file.

**C. Full Indonesian product.** B plus clearance lookup (§10.3), PB1 handling,
the withholding hook (§6.3), and an Indonesian buyer to sell it to — which §1
says is a different customer from the one the README describes.

**D. Neither.** §1 is a genuine commercial finding, and "the Indonesian sole
trader has no deductions to compliance-check" may simply be the answer. It does
not affect §9: the corpus argument stands on its own even if no Indonesian
feature is ever built.

§7.1 is the one item that is a defect under every option including D.

---

## Sources

- Effective rate and DPP Nilai Lain: [ARMA Law on PMK 131/2024](https://www.arma-law.com/news-event/newsflash/vat-rate-of-12-in-effect-tax-base-dpp-adjusted-no-change-in-tax-payable) · [Deloitte taxathand](https://www.taxathand.com/article/38308/Indonesia/2025/VAT-rate-increased-to-12-as-from-1-January-2025) · [PwC Worldwide Tax Summaries](https://taxsummaries.pwc.com/indonesia/corporate/other-taxes)
- Faktur pajak, NSFP, Coretax, clearance and the 20th-of-month deadline: [E-Invoicing Compliance Corner — Indonesia](https://e-invoicingcompliancecorner.com/indonesia) · [DJP: Kode Transaksi Faktur Pajak](https://www.pajak.go.id/en/node/88821)
- Retail faktur pajak and non-creditability: [DJP: Faktur Pajak Eceran](https://pajak.go.id/en/node/88820) · [DJP: Faktur Pajak yang Digunggung](https://pajak.go.id/en/node/102825) · [Pajakku: Panduan Faktur Pajak Pedagang Eceran](https://artikel.pajakku.com/panduan-faktur-pajak-pedagang-eceran-digunggung-terbaru) · [IKPI on PER-11/2025](https://ikpi.or.id/en/per-11-2025-faktur-pajak-pedagang-eceran-tak-lagi-bergantung-pada-klu-ini-penjelasannya/) · [Ortax: Pajak Masukan yang Tidak Dapat Dikreditkan](https://ortax.org/ketentuan-pajak-masukan-yang-tidak-dapat-dikreditkan)
- PB1 / PBJT: [Pajakku: Pajak Restoran PB1](https://pajakku.com/artikel/pajak-restoran-pb1-tarif-cara-hitung-dan-manfaatnya) · [OCBC: PB1 vs PPN](https://www.ocbc.id/id/article/2024/02/15/pb1-adalah) · [Klikpajak: Pajak Restoran dan Hotel](https://klikpajak.id/blog/pajak-restoran-pengertian-tarif-hitung-bayar-dan-lapor-pb1/)
- Exempt basic necessities: [DDTC on PP 49/2022](https://news.ddtc.co.id/pp-49-2022-perinci-barang-pokok-yang-dapat-fasilitas-bebas-ppn-44233) · [PP 49/2022 full text](https://peraturan.go.id/id/pp-no-49-tahun-2022)
- NPWP 16-digit / NIK / NITKU: [DJP: Adjusting Affected Systems](https://pajak.go.id/en/node/103788) · [DJP: Coretax, Era NPWP 16 digit](https://pajak.go.id/en/node/114311) · [DDTC: NIK, NPWP 16 digit, NITKU](https://news.ddtc.co.id/literasi/kamus/1803684/apa-beda-nik-sebagai-npwp-npwp-16-digit-dan-nitku) · [Acclime](https://indonesia.acclime.com/insights/new-16-digit-tax-id-nik-npwp/)
- 15-digit check digit (weak, see §10.1): [Business::ID::NPWP](https://metacpan.org/release/SHARYANTO/Business-ID-NPWP-0.02/view/lib/Business/ID/NPWP.pm)
- PP 23 / PP 20/2026 / corporate rate / WHT: [Emerhub on PP 20/2026](https://emerhub.com/news/indonesia-removes-0-5-final-tax-for-corporate-forms/) · [3E Accounting: PPh Final UMKM 2026](https://www.3ecpa.co.id/infographics/8-pph-final-umkm-rules-for-indonesian-founders-in-2026/) · [Emerhub: Deductible Expenses and WHT](https://emerhub.com/indonesia/deductible-expenses/)
- Retention: [DJP KP2KP Enrekang on Pasal 28(11)](https://pajak.go.id/en/node/111435) · [DDTC: Alasan Dokumen Wajib Disimpan 10 Tahun](https://news.ddtc.co.id/berita/nasional/1805429/alasan-dokumen-dasar-pembukuan-wajib-disimpan-selama-10-tahun) · [UU 28/2007](https://pajak.go.id/en/node/35330)
- SPT Masa PPN: [OnlinePajak](https://www.online-pajak.com/seputar-efaktur-ppn/spt-masa-ppn)
- CORD: [clovaai/cord (CC-BY 4.0)](https://github.com/clovaai/cord) · [CORD paper](https://openreview.net/pdf?id=SJl3z659UH)
