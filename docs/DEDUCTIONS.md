# Deductions: from a receipt to Free Tax Returns

How a scanned receipt becomes a line in a person's Free Tax Returns (FTR) worksheet.
Group plan phase 4 built the pipe (4.1 bundle format, 4.2 categories, 4.3 totals,
4.4 export, 4.8 direct send); the 2026-11-25 work ("receipts travel to FTR") added the
screens that let a person put a receipt into it. Written 2026-11-26.

## What a work expense is

A receipt is a work expense (or another tax deduction) when **a person** files it in a
category of their **personal** space that carries an ATO label and an FTR item
(`categories.ato_deduction_code` + `categories.engine_row_id`). Every personal space starts
with 16 such categories (`PERSONAL_DEDUCTION_CATEGORIES` in
`apps/server/src/settings/deduction-categories.ts`; migration 0042 backfilled older spaces),
plus five rental ones that start switched off. A person can also give their own category a
label (`PATCH /v1/settings/categories/:name`, `taxLabel`).

- **Deduction type** = the category (its label and item). There is no separate field.
- **Who chose it** = `documents.category_source`. Only `user` counts. `supplier` (copied
  from an earlier receipt from the same shop) is reported as "to confirm" and never sent.
- **Private use** = the category's `private_use_percent` (0-99), taken off each receipt
  before anything is sent. There is no per-receipt share.
- **Amount** = what was paid, GST included (employees claim the GST). A line filed in a
  category of its own (`document_lines.category_id`) counts its amount there; the receipt's
  category counts the rest of `payable_amount`. Never the sum of the lines: a tax invoice can
  list them before GST, and a reading can miss one. No screen files single lines yet.
- **Year** = `documents.issue_date`, Australian financial year 1 Jul to 30 Jun. Undated,
  rejected, deleted, non-AUD, credit notes and statements are left out.

## Where a person files it

- Phone and PWA (`apps/mobile`): the receipt screen's **Tax return** card
  (`WorkExpenseCard`), open after the receipt is confirmed too. It lists work and other tax
  categories first, each with its ATO label, then everyday ones. "Confirm category" files a
  supplier-filed one as the person's own choice.
- Web (`apps/web`): the same card on `/app/documents/[id]` for the personal space.
- Both send `PATCH /v1/documents/:id` with only `header.category_id`. A category-only edit
  leaves the compliance verdict alone.
- Shared wording and rules: `packages/api-contract/src/work-expense.ts`. ATO label names are
  printed for D1-D5, D9 and D10 only. The bundle's D12 (income protection) and D14 (personal
  super) follow FTR's worksheet, which is not how the ATO numbers those labels, so no number is
  printed for them.

## What goes

Bundle v1, unchanged (`packages/api-contract/src/deduction-bundle-spec.ts`, shared byte for
byte with FTR): one line per (label, item) with the summed work-share amount, `gstInclusive:
true`, the receipt count and up to 20 receipt fingerprints (SHA-256 of the stored original).
No shop names, dates, images or line descriptions. `privateUsePercent` is omitted because
the amount already has it taken off.

`GET /v1/deduction-bundle/contents?fy=` counts what a send would carry (lines, receipts,
work km, receipts to confirm); the send card on both clients prints it with
`describeSendContents`.

## What FTR does with it

The person reviews each line in FTR and presses "Add to worksheet"; nothing is applied
without that. Where each item lands: FTR `src/lib/import/README.md`.
