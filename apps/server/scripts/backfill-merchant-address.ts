/**
 * One-off backfill for plan task 9.5.h: the merchant address of receipts scanned
 * BEFORE the extraction learned to read it.
 *
 *   pnpm exec tsx scripts/backfill-merchant-address.ts \
 *       --tenant <uuid> [--tenant <uuid> ...] [--limit 1000] [--apply]
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
 * What it writes. `parties.address_line1 / city / state / postcode`, and only
 * for a supplier that has NONE of the four today (a strictly empty address).
 * So it is idempotent (a second run finds nothing to do), never overwrites a
 * value a scan or a person already stored, and never fills half an address
 * beside someone else's. The most recent receipt that parses wins per supplier.
 *
 * Privacy. Only the four normalised merchant fields are stored. The OCR text
 * is read in memory and never printed or persisted; the report shows counts and
 * the suburb/state/postcode of each supplier that would be filled.
 *
 * Must run where the object storage is mounted: the worker container on
 * helios (`docker exec`), with the worker's database login (an `app_worker`,
 * entering each tenant through `withWorkerTenant`, exactly as the extraction
 * worker does). Australian workspaces only: a tenant whose country is not AU
 * is skipped.
 */
import 'reflect-metadata';

import { sql } from 'drizzle-orm';

import type { Document } from '@snap/api-contract/docdom';

import { closeDb, useWorkerConnection } from '../src/db.js';
import { addressFromLayout } from '../src/extraction/merchant-backfill.js';
import { get } from '../src/storage.js';
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

let seen = 0;
let filled = 0;
let noLayout = 0;
let noAddress = 0;

for (const tenantId of tenants) {
  await enterTenantAsWorker(worker, tenantId, async (tx) => {
    const t = await tx.execute<{ country: string }>(
      sql`select country::text as country from tenants where id = ${tenantId}`,
    );
    if (t.rows[0]?.country !== 'AU') {
      console.log(`tenant ${tenantId}: not an Australian workspace, skipped`);
      return;
    }
    // One row per (supplier with an entirely empty address, a receipt of theirs),
    // newest receipt first, with that receipt's latest stored layout if any.
    const rows = await tx.execute<{ supplier_id: string; storage_key: string | null }>(sql`
      select d.supplier_id, l.storage_key
        from documents d
        join parties p on p.id = d.supplier_id and p.kind = 'supplier'
        left join lateral (
          select storage_key from document_layouts
           where capture_id = d.capture_id order by created_at desc limit 1
        ) l on true
       where d.tenant_id = ${tenantId}
         and d.deleted_at is null
         and coalesce(p.address_line1, '') = '' and coalesce(p.city, '') = ''
         and coalesce(p.state, '') = '' and coalesce(p.postcode, '') = ''
       order by d.created_at desc
       limit ${limit}
    `);

    const done = new Set<string>();
    const considered = new Set<string>();
    for (const row of rows.rows) {
      if (done.has(row.supplier_id)) continue;
      considered.add(row.supplier_id);
      if (!row.storage_key) {
        noLayout++;
        continue;
      }
      let address;
      try {
        address = addressFromLayout(JSON.parse(get(row.storage_key).toString('utf8')) as Document);
      } catch {
        noLayout++; // a missing or unreadable file is treated as no layout, never fatal
        continue;
      }
      if (!address) {
        noAddress++;
        continue;
      }
      done.add(row.supplier_id);
      filled++;
      console.log(
        `${apply ? 'fill' : 'would fill'} supplier ${row.supplier_id}: ` +
          `${address.city ?? '-'} ${address.state ?? '-'} ${address.postcode ?? '-'}${address.line1 ? ' (+street)' : ''}`,
      );
      if (apply) {
        // The WHERE repeats the emptiness test, so a value stored between the
        // read above and this write is never overwritten.
        await tx.execute(sql`
          update parties
             set address_line1 = ${address.line1}, city = ${address.city},
                 state = ${address.state}, postcode = ${address.postcode}
           where id = ${row.supplier_id}
             and coalesce(address_line1, '') = '' and coalesce(city, '') = ''
             and coalesce(state, '') = '' and coalesce(postcode, '') = ''
        `);
      }
    }
    seen += considered.size;
  });
}

console.log(
  `${apply ? 'APPLIED' : 'DRY RUN (nothing written)'}: ${seen} supplier(s) with an empty address considered, ` +
    `${filled} ${apply ? 'filled' : 'fillable'}; receipts skipped: ${noLayout} with no readable stored layout, ` +
    `${noAddress} with no header address.`,
);
await closeDb();
