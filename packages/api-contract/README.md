# @snap/api-contract

Wire types shared between the mobile app and the server, plus the few pure
functions both sides must agree on. No runtime dependencies. See the header of
`src/index.ts` for the boundary rule.

## Deduction bundle v1

The file SnapApp exports for **one financial year of a personal workspace** and
Free Tax Returns (FTR) imports into its worksheet. Scope is employee deductions
and rental properties only; sole-trader business costs are not exported.
Format only: the export job and the importer are later tickets (group 4).

- Code: `src/deduction-bundle.ts` (types and validator) and
  `src/deduction-bundle-spec.ts` (constants, item catalogue, regexes).
  Import from `@snap/api-contract/deduction-bundle`.
- FTR twin: a zod schema in `src/lib/import/deduction-bundle.ts` of
  `gaiadabali/free-tax-return`, with the same spec file and fixtures.
- Fixtures: `fixtures/deduction-bundle-v1/` (valid and invalid cases, plus
  `index.json` with the expected issue paths and a SHA-256 per file).
  Identical bytes in both repos; the root test `test/deduction-bundle-fixtures.test.ts`
  pins the manifest hash. **Change the spec file or a fixture in both repos or in neither.**

```jsonc
{
  "schemaVersion": 1,                       // literal 1; any other value is rejected
  "financialYear": "2025-26",               // 1 Jul 2025 to 30 Jun 2026; YYYY-YY, second part = first + 1 mod 100, 2000-01 to 2099-00
  "generatedAt": "2026-07-14T03:21:09Z",    // UTC, Z suffix, optional .sss
  "source": { "app": "snapapp", "appVersion": "1.4.0" },
  "occupation": "teacher",                  // optional; one of FTR's 19 profile ids (OCCUPATION_IDS)
  "workKilometres": 1200,                   // optional; whole business km for FTR's cents-per-km method
  "lines": [                                // 0 to 500
    {
      "label": "D5",                        // D1 D2 D3 D4 D5 D9 D10 D12 D14 RENTAL
      "itemId": "phoneDevices",             // must belong to that label's list in ITEM_IDS
      "description": "Mobile phone, work portion",  // 1-200 chars, no control chars; item text, never merchant or person
      "amount": "899.00",                   // AUD decimal string, see below
      "gstInclusive": true,                 // true when amount includes GST
      "privateUsePercent": 60,              // optional; whole percent 1-99; amount is before this is applied
      "receiptCount": 1,                    // 0-10000, never below receiptRefs.length
      "receiptRefs": ["9261...74e4"]        // 0-20 x SHA-256 hex (lowercase) of the receipt's original file bytes
    }
  ]
}
```

**Amounts** are decimal strings in AUD matching
`^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,8}\.\d{2})$`: positive, exactly two
decimals, no sign, no thousands separator, at most 9 integer digits. A JSON
number is rejected. Credits are netted by the exporter, so a line is never negative.

**Minimal PII.** No name, email, tax file number or merchant. Unknown keys are
rejected at every level, so a field cannot slip in. FTR attaches the bundle to the
signed-in user. Receipt references are hashes, never images.

**Limits** (all in `deduction-bundle-spec.ts`): 500 lines, 200-character
descriptions, 20 receipt references per line, 10,000 receipts per line,
200,000 work km, and 2 MiB (UTF-8 bytes) for the whole file. Use
`validateDeductionBundleJson(text)` to enforce the size before parsing. A
schema-valid bundle always fits within the 2 MiB limit (tested).

**What an `itemId` names** depends on the label; see the comment on `ITEM_IDS`.
D1, D3 and RENTAL use FTR's engine item ids. D5 uses the equipment category id,
because FTR's per-item D5 ids are positional per occupation (`ppewear_3`).
D2 and D4 use worksheet state field names; D9, D12 and D14 are a single row
kind each.

**Errors** come back as `{ path, message }` with a dotted path (`lines.2.amount`,
`''` for the root). Both validators agree on paths for single-defect input. The
receiptCount-versus-receiptRefs rule only runs when nothing else is wrong.
