# Alpha.01.00.000 — closing the gaps

The gaps named in the `Alpha.01.00.000` commit message, and who can close each.
Ordered by demo impact, not by technical interest.

| # | Gap | Closable by | Lane |
|---|---|---|---|
| 1 | Mobile never exercised on a real client | **Me, partly** — the Expo web build can be driven headlessly; a physical device still cannot | N |
| 2 | Double-entry ledger is schema-only | Me | L |
| 3 | No BAS report | Me | M |
| 4 | No golden set of real AU receipts | **Hansel only** — needs real photographed dockets | — |
| 5 | Confidence not calibrated | Blocked on #4 | — |
| 6 | PowerSync / Xero / Stripe | Later roadmap phases, not demo-critical | — |

#4 is the one that cannot be delegated or synthesised. `docs/PLAN.md` §8 says it
plainly: *"the single highest-leverage artefact in this plan… build it before
tuning anything."* Fifty real receipts — supermarket, servo, café, a tradie
invoice, one handwritten — photographed as a user would, with the true values
typed once. Everything about accuracy is a guess until they exist, and #5 is
simply impossible without them.

---

## Lane L — the ledger stops being decorative

`packages/db` migration 0006 has `accounts`, `transactions`, `transaction_splits`
and `tax_codes`, with a deferred sum-zero constraint trigger verified against
PostgreSQL 17. **The application has never posted to any of it** —
`transaction_splits` appears once in the entire server, in a check added for
re-extraction. `docs/PLAN.md` principle 3 is that the books are provably
balanced; today that is a claim about a schema nobody writes to.

Build, in `apps/server`:

1. `POST /v1/documents/:id/transaction` — propose a **draft** transaction from a
   confirmed document. Splits come from the document's lines and tax subtotals:
   expense lines positive, GST receivable positive, the payment account
   negative, summing to zero. Worked example in `docs/PLAN.md` §5.
2. `POST /v1/transactions/:id/post` — draft → posted. The database enforces the
   balance; do not re-implement that check in TypeScript. A deliberately
   unbalanced posting must be **rejected by Postgres**, and the test must prove
   that rather than assert it.
3. `GET /v1/transactions` — list with splits, for the app and for the demo.
4. Tax codes drive the GST treatment (`GST`, `CAP`, `FRE`, `INP`, `N-T`), and a
   document that is not a valid tax invoice must not produce a claimable GST
   split. `documents.is_tax_invoice` already carries that verdict.

Rules:
- A document already carrying a posted transaction may not produce a second one.
- Posting is a separate act from confirming, separately audited — `PLAN.md`
  §5.1 guarantee 3.
- Staff may capture but not post. The role check exists; use it.

## Lane M — BAS

The tax codes in migration 0005 each declare their BAS label mapping, which was
the entire point of that table: reporting should be a `GROUP BY`, not a
translation layer.

Build `GET /v1/reports/bas?from=&to=` returning G1, G10, G11, 1A, 1B, plus the
unclaimable-GST figure, over **posted** transactions only.

The exit criterion from `docs/PLAN.md` §8, unchanged: the output reconciles —
`1A ≈ G1/11`, `1B ≈ (G10+G11)/11` — and **1B excludes every document that is
not a valid tax invoice**. That last clause is the one that matters: it is the
difference between a BAS a person can lodge and one that invents a credit.

## Lane N — drive the app, headlessly, for real

Every mobile change this session was verified by typecheck and unit tests. The
capture flow is what a demo shows and nobody has watched it work.

Drive the **Expo web build** with Playwright against the real server: sign in,
capture (a file, since there is no camera), watch the pages upload, wait for
extraction, open the document, page through it, correct a field, confirm it.
Screenshot each step.

This does not replace a physical device — the camera, the native module and the
share sheet are all untestable this way, and the report must say so rather than
implying coverage it does not have. It does answer the question nobody has
asked yet: does the flow work at all against a real backend?
