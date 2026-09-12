# Snap Apps — Channel, pricing & unit economics

**Date:** 2026-09-09 · **Currency:** AUD, GST-inclusive where quoted to consumers
**Supersedes** the direct-to-consumer tiering in this file's previous revision. See §1 for why.

---

## 1. Why this was rewritten

The first version priced Snap Apps as a D2C subscription — Free / $9.99 / $24.99 — and analysed
App Store commission as the dominant cost. Research on the actual market says that is the wrong
buyer:

| Finding | Consequence |
|---|---|
| **Hubdoc is free with every Xero Business plan** since 2018 — no document cap, no seat licence. Xero dominates AU. | You cannot sell generic receipt capture to a Xero-using SMB. The incumbent is free and already installed. |
| **ATO myDeductions is free**, and from 1 July 2026 uploads straight into myTax prefill. | That is the free tier's competitor, government-backed. |
| **Expensify**: 2026 revenue down 5–6% YoY, share price ~$0.97, still loss-making. | Standalone expense management as a D2C/SMB SaaS is not thriving. |
| Sub-$1M-ARR SaaS sees **median 2.7% monthly logo churn** (>30%/yr); a consumer chore app does worse. | $9.99 D2C means permanently refilling a leaking bucket. |
| **Dext's working line is Practice: US$17.70–19.20 per client/month, 10-client minimum**, sold to firms. | The channel that works is accountants and bookkeepers. |

### The channel arithmetic

| | 50-client practice | Equivalent D2C |
|---|---|---|
| Revenue | ~$950/mo | ~95 × $9.99 = ~$950/mo |
| Sales motions required | **1** | **95** |
| Who onboards and supports the user | the accountant | you |
| Churn | very low — practices standardise and don't re-tool | 30%+/yr |
| Payment rail | Stripe (~2%) | App Store IAP (15–30%) |

Same revenue, two orders of magnitude less work — and it sidesteps the app-store commission that
dominated the old analysis entirely, because practices buy on the web.

---

## 2. The wedge: what free tools structurally cannot do

Two gaps, both of which the schema already models:

1. **myDeductions is built around the annual return, not quarterly BAS.** GST-registered sole
   traders, tradies and truckies hit that wall four times a year.
2. **Hubdoc captures header-level data only, and only for Xero.** No per-category tax subtotals — so
   it cannot separate a grocery receipt's GST-free half from its taxable half.

Snap Apps has `document_tax_subtotals` (Peppol BG-23), BAS label mapping through `tax_codes`, and
the `is_tax_invoice` gate on label 1B. Plus the occupation engine, which a competitor cannot copy in
a quarter because it took a tax consultant's spreadsheet to build.

**Positioning:** not "a receipt scanner". **A BAS and deduction-compliance layer for Australian sole
traders and tradies, sold through accountants, funnelled by free-tax-returns.**

---

## 3. Pricing

### Practice (the primary line)

Sold to accounting and bookkeeping firms. Billed to the **firm**, not the client.

| Plan | Price | Minimum | Includes per client |
|---|---|---|---|
| **Practice** | **$19 / client / month** | 10 clients | 200 scans/mo, realtime, BAS pack, Xero sync |
| **Practice Plus** | **$29 / client / month** | 10 clients | 600 scans/mo, multi-entity, API, priority queue, white-label client app |

Deliberately under Dext (≈A$27/client equivalent) — you are the challenger, and the AU tax
intelligence is the differentiator, not the price. Annual billing: 2 months free.

### Direct (the funnel line)

For sole traders arriving from free-tax-returns, with no accountant.

| Plan | Price | Scans/mo | Notes |
|---|---|---|---|
| **Free** | $0 | 20 | Batch extraction (≤1h), 12-month retention. The funnel. |
| **Sole Trader** | **$29/mo** incl GST | 150 | Realtime, BAS pack, Xero sync, 5-year retention |

Priced *above* the practice per-client rate on purpose: direct customers cost more to serve, and it
gives an accountant a reason to bring their clients onto a practice plan.

---

## 4. Unit economics

Extraction is ~$0.011/scan blended (Haiku 4.5 primary, Sonnet 5 escalation); storage ~$0.002/scan
across the 5-year ATO retention window.

### Per client on a practice plan

| | Light client (40 scans/mo) | Heavy client (200 scans/mo) |
|---|---|---|
| Revenue | $19.00 | $19.00 |
| AI extraction | −$0.44 | −$2.20 |
| Storage (yr 1) | −$0.02 | −$0.08 |
| Stripe (~2%, at firm level) | −$0.38 | −$0.38 |
| **Gross margin** | **$18.16 · 96%** | **$16.34 · 86%** |

### Per firm

| Firm size | MRR | AI cost/mo | Gross margin |
|---|---|---|---|
| 10 clients (minimum) | $190 | ~$8 | ~92% |
| 50 clients | $950 | ~$40 | ~92% |
| 200 clients | $3,800 | ~$160 | ~92% |

**AI is 2–4% of revenue.** This is the number that settles the model-selection question from the
previous revision: at these margins, chasing a cheaper model to save $0.009/scan is not where the
leverage is. Accuracy is worth more than the saving, because an accountant who stops trusting the
extraction churns the whole firm.

The free tier costs ~$0.11/user/month. Ten thousand free users is ~$1,100/mo — a marketing budget.

---

## 5. Distribution

The channel is Xero's, and it is explicit about how apps reach customers:

1. **Xero App Store listing.** Table stakes; this is where advisors look.
2. **Xero Advisor Directory + one-click advisor recommendation.** Advisors recommend apps to clients
   directly from Xero. This is the actual acquisition mechanism in this category.
3. **free-tax-returns as the consumer funnel.** Individuals arrive at tax time, convert to the direct
   plan, and their accountant is then the practice lead.
4. **Practice-led onboarding.** The firm migrates its own client base; you are not acquiring 50
   users, you are configuring one firm.

Consequence for the roadmap: **Xero integration moves from phase 7 to early.** It is not a feature,
it is the distribution channel and the credibility signal.

---

## 6. Metering under the practice model

Scan quota is metered per **client tenant**; billing rolls up to the **firm**. Schema in
`data-model.sql` §14 plus migration `0011_firms.sql`:

- `subscriptions` may belong to a firm **or** a tenant, never both — enforced by a CHECK.
- `usage_counters` stay tenant-level, so a firm sees which client is heavy.
- Soft cap: at quota, the firm is offered a top-up, never a refused scan.
- **Never drop a capture.** If quota is gone, the image is still stored; extraction runs later.
- `v_tenant_cost_vs_price` catches a client whose real inference spend outruns their seat price.

---

## 7. What this does not change

The technical work stands, and is arguably more correct under this model: multi-tenant with RLS is
exactly what a firm managing 50 client tenants needs, and `memberships` already carries a
`bookkeeper` role.

## 8. The risk that is not competitive

Selling BAS figures carries materially more liability than selling a receipt scanner. If a 1B figure
is wrong, it is the client's problem with the ATO and then yours.

**The tax-agent sign-off gate inherited from `free-tax-returns` stops being a launch nicety and
becomes the thing that lets you sell to accountants at all.** They will ask who signed off on the
rates, and "a consultant's spreadsheet, with 217 tests" is a good answer only once the sign-off
checkbox is actually ticked.

---

## 9. Open questions

| # | Question | Default |
|---|---|---|
| M1 | Practice minimum: 10 clients like Dext, or 5 to lower the barrier? | 10 — it signals a real practice and protects support load |
| M2 | White-label the client app for firms? | Practice Plus only; it is a strong upsell and a switching cost |
| M3 | Revenue share with the referring accountant? | No. Discount the practice rate instead — simpler, no trail commission bookkeeping |
| M4 | Keep the D2C app-store presence at all? | Yes, but as a funnel and a demo surface, not the revenue line |
| M5 | Charge for the BAS pack separately? | No. It is the wedge; making it an add-on blunts the pitch |
