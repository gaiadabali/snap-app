import type { Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import type { Document } from '@snap/api-contract/docdom';

import { get } from '../storage.js';

import { addressFromLayout } from './merchant-backfill.js';

/**
 * The database half of the merchant-address backfill (plan tasks 9.5.h and
 * 9.5.i), kept out of `scripts/backfill-merchant-address.ts` so a test can drive
 * it. The script owns arguments, the worker login and printing the total; this
 * owns what is read, what is written and what is reported per row.
 *
 * It fills TWO places from the same stored OCR layout, with the same rules:
 *
 *   - the RECEIPT (`documents.merchant_*`, 9.5.i): each receipt gets the address
 *     read from ITS OWN layout, so two branches of one chain differ;
 *   - the SUPPLIER (`parties.address_*`, 9.5.h): as before, a supplier whose four
 *     address columns are ALL empty takes the address of its newest receipt that
 *     parses. Unchanged behaviour.
 *
 * Rules, for both: dry run unless `apply`; only strictly empty targets (all four
 * columns empty), so a second run finds nothing to fill and never overwrites a
 * value a scan or a person stored, and never writes half an address beside
 * someone else's; the write repeats the emptiness test in its WHERE so a value
 * stored between the read and the write survives; the OCR text is parsed in
 * memory and never logged, returned or stored.
 */

export type BackfillOptions = {
  /** Write. Without it nothing is changed. */
  apply: boolean;
  /** At most this many receipts are looked at per workspace, newest first. */
  limit: number;
  /** Reads one stored layout object. Defaults to object storage; tests pass a fake. */
  read?: (storageKey: string) => Buffer;
  /** One line per row that is (or would be) filled: ids and the normalised place only. */
  log?: (line: string) => void;
};

export type BackfillResult = {
  /** True when the workspace is not Australian and was left alone. */
  skipped: boolean;
  /** Receipts looked at (an empty receipt address or an empty supplier address). */
  receiptsConsidered: number;
  receiptsFilled: number;
  suppliersFilled: number;
  /** Receipts with no stored layout, or one that could not be read. */
  noLayout: number;
  /** Receipts whose header has no parseable address. */
  noAddress: number;
};

type Row = {
  document_id: string;
  supplier_id: string | null;
  storage_key: string | null;
  receipt_empty: boolean;
  supplier_empty: boolean;
};

export async function backfillMerchantLocations(
  tx: Tx,
  tenantId: string,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const read = opts.read ?? get;
  const log = opts.log ?? (() => {});
  const result: BackfillResult = {
    skipped: false,
    receiptsConsidered: 0,
    receiptsFilled: 0,
    suppliersFilled: 0,
    noLayout: 0,
    noAddress: 0,
  };

  const t = await tx.execute<{ country: string }>(
    sql`select country::text as country from tenants where id = ${tenantId}`,
  );
  if (t.rows[0]?.country !== 'AU') {
    result.skipped = true;
    return result;
  }

  // One row per receipt that has something to fill (its own address is empty, or
  // its supplier's is), newest first, with that receipt's latest stored layout.
  const rows = await tx.execute<Row>(sql`
    select d.id as document_id, d.supplier_id, l.storage_key,
           (coalesce(d.merchant_line1, '') = '' and coalesce(d.merchant_city, '') = ''
            and coalesce(d.merchant_state, '') = '' and coalesce(d.merchant_postcode, '') = '') as receipt_empty,
           (p.id is not null
            and coalesce(p.address_line1, '') = '' and coalesce(p.city, '') = ''
            and coalesce(p.state, '') = '' and coalesce(p.postcode, '') = '') as supplier_empty
      from documents d
      left join parties p on p.id = d.supplier_id and p.kind = 'supplier'
      left join lateral (
        select storage_key from document_layouts
         where capture_id = d.capture_id order by created_at desc limit 1
      ) l on true
     where d.tenant_id = ${tenantId}
       and d.deleted_at is null
       and (
         (coalesce(d.merchant_line1, '') = '' and coalesce(d.merchant_city, '') = ''
          and coalesce(d.merchant_state, '') = '' and coalesce(d.merchant_postcode, '') = '')
         or (p.id is not null
             and coalesce(p.address_line1, '') = '' and coalesce(p.city, '') = ''
             and coalesce(p.state, '') = '' and coalesce(p.postcode, '') = '')
       )
     order by d.created_at desc
     limit ${opts.limit}
  `);

  const supplierDone = new Set<string>();
  for (const row of rows.rows) {
    result.receiptsConsidered++;
    if (!row.storage_key) {
      result.noLayout++;
      continue;
    }
    let address;
    try {
      address = addressFromLayout(JSON.parse(read(row.storage_key).toString('utf8')) as Document);
    } catch {
      result.noLayout++; // a missing or unreadable file is treated as no layout, never fatal
      continue;
    }
    if (!address) {
      result.noAddress++;
      continue;
    }
    const place = `${address.city ?? '-'} ${address.state ?? '-'} ${address.postcode ?? '-'}${address.line1 ? ' (+street)' : ''}`;

    if (row.receipt_empty) {
      result.receiptsFilled++;
      log(`${opts.apply ? 'fill' : 'would fill'} receipt ${row.document_id}: ${place}`);
      if (opts.apply) {
        // The WHERE repeats the emptiness test, so a value stored between the
        // read above and this write (a scan, a re-extraction) is never overwritten.
        await tx.execute(sql`
          update documents
             set merchant_line1 = ${address.line1}, merchant_city = ${address.city},
                 merchant_state = ${address.state}, merchant_postcode = ${address.postcode}
           where id = ${row.document_id}
             and coalesce(merchant_line1, '') = '' and coalesce(merchant_city, '') = ''
             and coalesce(merchant_state, '') = '' and coalesce(merchant_postcode, '') = ''
        `);
      }
    }

    // 9.5.h, unchanged: the supplier takes the newest receipt that parses.
    if (row.supplier_empty && row.supplier_id && !supplierDone.has(row.supplier_id)) {
      supplierDone.add(row.supplier_id);
      result.suppliersFilled++;
      log(`${opts.apply ? 'fill' : 'would fill'} supplier ${row.supplier_id}: ${place}`);
      if (opts.apply) {
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
  }
  return result;
}
