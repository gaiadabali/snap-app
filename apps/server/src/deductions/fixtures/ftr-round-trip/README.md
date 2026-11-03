# FTR round-trip golden bundle (plan 4.9.a)

`bundle.golden.json` is what SnapApp's real exporter (`foldTotals` + `buildDeductionBundle`)
produces for the receipts in `../../ftr-round-trip.test.ts`. Free Tax Returns keeps a
byte-identical copy at `src/lib/import/fixtures/round-trip/bundle.golden.json` and checks
that its importer and engine total the same cents per label.

Both tests pin the file's SHA-256, so a drift on either side fails that side.

## Refresh both (change the receipts, or the exporter, on purpose)

1. SnapApp: `cd apps/server && UPDATE_GOLDEN=1 pnpm vitest run src/deductions/ftr-round-trip.test.ts`
   rewrites the golden and prints `golden sha256: ...`. Put that hash in `GOLDEN_SHA256`
   and fix the hand-computed totals in the test.
2. Copy the file to FTR unchanged: `cp bundle.golden.json <ftr>/src/lib/import/fixtures/round-trip/`.
3. FTR: set the same hash in `round-trip.test.ts`, update its expected cents, run
   `pnpm vitest run src/lib/import/round-trip.test.ts`.
4. Land both PRs together.
