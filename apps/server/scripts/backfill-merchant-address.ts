/**
 * One-off backfill for plan tasks 9.5.h and 9.5.i: the merchant address of
 * receipts scanned BEFORE the extraction learned to read it, on each RECEIPT
 * (`documents.merchant_*`) and, as before, on its supplier (`parties`).
 *
 *   pnpm exec tsx scripts/backfill-merchant-address.ts  *       --tenant <uuid> [--tenant <uuid> ...] [--limit 1000] [--apply]
 *
 * DRY RUN BY DEFAULT: without `--apply` nothing is written; it prints what it
 * WOULD fill. Run the dry run first and read the numbers.
 *
 * Where the text comes from. No model is called and no receipt is re-extracted
 * (that costs money and would re-save the document). Receipts whose OCR shadow
 * stage ran have a DocDOM stored in object storage (`document_layouts`,
 * migration 0019: `<tenant>/layouts/<capture>/<run>.json`). This reads that,
 * keeps ONLY the first page's header lines (`merchant-backfill.ts`), and parses
 * a "SUBURB STATE 2000" line deterministically (`merchant-address.ts`). A
 * receipt with no stored layout, or no such line in its header, is left alone.
 *
 * What it writes (all of it in `merchant-backfill.repo.ts`):
 *   - `documents.merchant_line1 / city / state / postcode` for a receipt whose
 *     four are ALL empty: the address read from that receipt's OWN layout, so
 *     two branches of one chain get two different places (migration 0061).
 *   - `parties.address_line1 / city / state / postcode` for a supplier whose
 *     four are ALL empty: the newest of its receipts that parses (unchanged
 *     from 9.5.h).
 * So it is idempotent (a second run finds nothing to do), never overwrites a
 * value a scan or a person already stored, and never fills half an address
 * beside someone else's.
 *
 * Run it AFTER migration 0061 is applied (it reads and writes the new columns).
 *
 * Privacy. Only the four normalised merchant fields are stored. The OCR text
 * is read in memory and never printed or persisted; the report shows counts and
 * the document or supplier id with the suburb/state/postcode of each row that
 * would be filled.
 *
 * Must run where the object storage is mounted: the worker container on
 * helios (`docker exec`), with the worker's database login (an `app_worker`,
 * entering each tenant through `withWorkerTenant`, exactly as the extraction
 * worker does). Australian workspaces only: a tenant whose country is not AU
 * is skipped.
 */
import 'reflect-metadata';

import { closeDb, useWorkerConnection } from '../src/db.js';
import { backfillMerchantLocations } from '../src/extraction/merchant-backfill.repo.js';
import { enterTenantAsWorker, workerActor } from '../src/tenant-entry.js';

useWorkerConnection();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tenants: string[] = [];
let limit = 1000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tenant' && args[i + 1]) tenants.push(args[++i]!);
  if (args[i] === '--limit' && args[i + 1]) limit = Math.max(1, Number(args[++i]) || limit);
}
if (tenants.length === 0) {
  console.error('usage: backfill-merchant-address --tenant <uuid> [--tenant <uuid> ...] [--limit N] [--apply]');
  process.exit(2);
}
const workerId = (process.env.WORKER_USER_ID ?? '').trim();
if (!workerId) {
  console.error('WORKER_USER_ID is not set (the worker service user, as in deploy/.env).');
  process.exit(2);
}
const worker = workerActor(workerId);

let receiptsConsidered = 0;
let receiptsFilled = 0;
let suppliersFilled = 0;
let noLayout = 0;
let noAddress = 0;

for (const tenantId of tenants) {
  await enterTenantAsWorker(worker, tenantId, async (tx) => {
    const r = await backfillMerchantLocations(tx, tenantId, { apply, limit, log: console.log });
    if (r.skipped) {
      console.log(`tenant ${tenantId}: not an Australian workspace, skipped`);
      return;
    }
    receiptsConsidered += r.receiptsConsidered;
    receiptsFilled += r.receiptsFilled;
    suppliersFilled += r.suppliersFilled;
    noLayout += r.noLayout;
    noAddress += r.noAddress;
  });
}

console.log(
  `${apply ? 'APPLIED' : 'DRY RUN (nothing written)'}: ${receiptsConsidered} receipt(s) with an empty receipt or supplier address considered; ` +
    `${receiptsFilled} receipt(s) ${apply ? 'filled' : 'fillable'}, ${suppliersFilled} supplier(s) ${apply ? 'filled' : 'fillable'}; ` +
    `skipped: ${noLayout} with no readable stored layout, ${noAddress} with no header address.`,
);
await closeDb();
