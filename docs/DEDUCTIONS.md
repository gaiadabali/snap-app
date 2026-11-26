# Deductions: from a receipt to Free Tax Returns

How a scanned receipt becomes a line in a person's Free Tax Returns (FTR) worksheet.
Group plan phase 4 built the pipe (4.1 bundle format, 4.2 categories, 4.3 totals,
4.4 export, 4.8 direct send); the 2026-11-25 work ("receipts travel to FTR") added the
screens that let a person put a receipt into it, and 2026-11-26 let a person mark single
lines of a receipt as work (one work item on a supermarket docket). Written 2026-11-26.

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
- **Amount** = what was paid, GST included (employees claim the GST). A receipt filed whole
  counts `payable_amount`. A line filed in a category of its own (`document_lines.category_id`,
  see "Work lines" below) counts what was paid for that line; the receipt's category counts
  the rest. Never the sum of the lines: a reading can miss one.
- **Year** = `documents.issue_date`, Australian financial year 1 Jul to 30 Jun. Undated,
  rejected, deleted, non-AUD, credit notes and statements are left out.

## Work lines: part of a receipt

A person can mark single lines of a receipt as work and give each one a work or other tax
category (the hammer on a supermarket docket). Only a person files a line, so a filed line
counts as their choice even while the receipt's own category is still the supplier memory's;
the rest of the receipt follows the receipt's category and its `category_source`.

The amount rule (`splitReceipt` in `packages/api-contract/src/receipt-split.ts`, the one
function both the server and the review screens run), in integer 1/10 000ths, never floats:

1. **Each line's cost, GST included.** `line_net_amount` holds the line *as printed* (the
   extractor's instruction; the column name is Peppol BT-131's, but on a retail docket the
   printed line already holds its GST, so adding 10% there would over-claim). The lines are
   read as printed *before* GST only when the receipt states its GST and the lines add up to
   `payable − tax` more closely than to `payable` (the validators' `linesGap` test). Then
   each standard-rated line (`gst_category_code` not Z, E or O) gets its share of the printed
   `tax_amount`, in proportion to its amount (largest remainder), when lines + GST make the
   total within 5c; otherwise 10% of its amount (half away from zero). GST-free lines get
   none. Otherwise every line is taken as printed. `discount_amount` is not used: BT-131 is
   already net of line discounts, and nothing writes the column.
2. **By category.** Lines filed in the same category add up. A category whose lines come to
   zero or less (a discount line marked on its own) is not split off; mark a discount with the
   item it came off.
3. **The rest** = `payable_amount` (what was paid, cash rounding included) less the lines split
   off. When the split-off lines come to more than the total (a misread line, or a discount
   printed only on the total), they are scaled down in proportion to exactly the total and the
   rest is nothing. A claim is never more than was paid.
4. **To cents.** The total is rounded half up to the cent; the parts (each filed category, then
   the rest) are rounded by largest remainder, ties to the earlier part, so they add up to that
   total exactly. A seeded 2 000-receipt test checks this for every shape.

The server folds a receipt into one source line per (category, who chose it), so a line filed
in the receipt's own category and the rest take a single private-use rounding. A receipt whose
rest has no category (or an everyday one) sends only its filed lines.

`PATCH /v1/documents/:id/lines/categories` `{ lines: [{ lineNumber, categoryId | null }],
version? }` files or unfiles the named lines; others are untouched. Rules: a read-only member
gets 403 (the same rule as filing the whole receipt); the category must be a work or tax
category (label AND item) of this workspace, which must be a personal space, else 400; an
unknown line number 400; a stale `version` 409. It bumps the document version and changes
nothing else: not a correction, so the compliance verdict stays.

A filed line survives its lines being replaced: `PUT /v1/documents/:id/lines` takes an
optional `categoryId` per line (null unfiles; it now also accepts the `lineNumber`,
`category` and `confidence` the screens send back, which the whitelist used to refuse), and
a line sent without one, like a re-reading of the receipt, keeps the category of the old
line with the same description (case and spacing ignored, same line number first). A line
whose description changed is unfiled.

## Where a person files it

- Phone and PWA (`apps/mobile`): the receipt screen's **Tax return** card
  (`WorkExpenseCard`), open after the receipt is confirmed too. It lists work and other tax
  categories first, each with its ATO label, then everyday ones. "Confirm category" files a
  supplier-filed one as the person's own choice. "Mark work lines" opens a sheet with every
  line, its cost GST included and a checkbox; a ticked line takes a work category (the last
  one chosen, or the receipt's own when that is one) and the running "Marked for work" total
  updates as lines are ticked. The card lists the marked lines.
- Web (`apps/web`): the same card on `/app/documents/[id]` for the personal space, with a
  "Work lines" form under the category (checkbox and work-category select per line, running
  total, "Save work lines").
- The card's status line (`workExpenseStatus`) says what goes for which financial year: the
  work lines' total GST included, and whether the rest goes under the receipt's category,
  waits for a confirm, or stays out.
- The whole-receipt category: `PATCH /v1/documents/:id` with only `header.category_id`. A
  category-only edit leaves the compliance verdict alone. Work lines: the PATCH above.
- Shared wording and rules: `packages/api-contract/src/work-expense.ts`. ATO label names are
  printed for D1-D5, D9 and D10 only. The bundle's D12 (income protection) and D14 (personal
  super) follow FTR's worksheet, which is not how the ATO numbers those labels, so no number is
  printed for them.

## What goes

Bundle v1, unchanged (`packages/api-contract/src/deduction-bundle-spec.ts`, shared byte for
byte with FTR): one line per (label, item) with the summed work-share amount, `gstInclusive:
true`, the receipt count and up to 20 receipt fingerprints (SHA-256 of the stored original).
No shop names, dates, images or line descriptions. `privateUsePercent` is omitted because
the amount already has it taken off. Work lines change only the amounts and counts inside
those lines (a receipt split over two items is counted in each item's `receiptCount` and once
in the total), never the shape, so FTR's importer needs no change.

`GET /v1/deduction-bundle/contents?fy=` counts what a send would carry (lines, receipts,
work km, receipts to confirm); the send card on both clients prints it with
`describeSendContents`.

## What FTR does with it

The person reviews each line in FTR and presses "Add to worksheet"; nothing is applied
without that. Where each item lands: FTR `src/lib/import/README.md`.
