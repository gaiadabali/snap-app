import { createHash } from 'node:crypto';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { get as readObject, put } from '../storage.js';
import { zip, type ZipEntry } from './zip.js';

/**
 * Assembling a tax pack.
 *
 * The pack IS the record. Under the ATO rules an electronic copy is acceptable
 * only if it is a true and clear reproduction, so what goes in is the original
 * bytes exactly as captured — never re-encoded, never resized, never the
 * extraction rendered back out as a tidy PDF. The extraction is a convenience
 * and it travels alongside, as a CSV, clearly a derived thing.
 *
 * Every filename carries the date, the supplier and the amount. An accountant
 * opening a folder of 300 photographs named by uuid has been handed a problem,
 * not a record.
 */

type PackRow = {
  id: string;
  issue_date: string | null;
  supplier_name: string | null;
  supplier_abn: string | null;
  payable_amount: string | null;
  tax_amount: string | null;
  is_tax_invoice: boolean;
  review_status: string;
  page_count: number;
  /**
   * EVERY page of the capture, in order — not just the first.
   *
   * `captures.original_storage_key` holds page 1 and nothing else, so reading
   * it alone exported a two-page tax invoice as one image while the index
   * claimed the document was complete. That is the same defect Phase 0 exists
   * to remove from capture, reappearing at the other end of the pipeline: it
   * is wrong AND it says it is right, on the record the ATO would be shown.
   */
  pages: Array<{ pageNumber: number; storageKey: string; mime: string }>;
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Safe on every filesystem, and still readable by a person. */
function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'unknown'
  );
}

/** A CSV field. Quoted whenever it could otherwise change the column count. */
function csv(value: string | null): string {
  const text = value ?? '';
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type AssembledPack = {
  key: string;
  filename: string;
  bytes: number;
  documentCount: number;
};

export async function assembleTaxPack(
  userId: string,
  tenantId: string,
  fromDate: string,
  toDate: string,
  periodLabel: string,
): Promise<AssembledPack> {
  const { rows, trips, tenantName } = await withTenantAs(
    getDb(),
    userId,
    tenantId,
    async (tx) => {
      const documents = await tx.execute<PackRow>(sql`
        select d.id, d.issue_date::text as issue_date,
               p.legal_name as supplier_name, p.abn as supplier_abn,
               d.payable_amount::text as payable_amount,
               d.tax_amount::text as tax_amount,
               d.is_tax_invoice, d.review_status::text as review_status,
               coalesce(c.page_count, 1) as page_count,
               -- Aggregated rather than joined, so a three-page capture stays
               -- ONE row here and does not silently triple the document count
               -- in the index. Falls back to the capture's own key for rows
               -- predating capture_pages (migration 0018).
               coalesce(
                 (select jsonb_agg(jsonb_build_object(
                           'pageNumber', cp.page_number,
                           'storageKey', cp.storage_key,
                           'mime', cp.mime_type)
                         order by cp.page_number)
                    from capture_pages cp where cp.capture_id = c.id),
                 case when c.original_storage_key is null then '[]'::jsonb
                      else jsonb_build_array(jsonb_build_object(
                             'pageNumber', 1,
                             'storageKey', c.original_storage_key,
                             'mime', c.original_mime_type))
                 end
               ) as pages
          from documents d
          left join parties p on p.id = d.supplier_id
          left join captures c on c.id = d.capture_id
         where d.deleted_at is null
           and d.review_status <> 'rejected'
           and d.issue_date between ${fromDate}::date and ${toDate}::date
         order by d.issue_date, d.id
      `);
      const tripRows = await tx.execute<{
        trip_date: string;
        from_place: string;
        to_place: string;
        km: string;
        purpose: string | null;
        work_related: boolean;
      }>(sql`
        select trip_date::text, from_place, to_place, km::text, purpose, work_related
          from trips
         where trip_date between ${fromDate}::date and ${toDate}::date
         order by trip_date
      `);
      const name = await tx.execute<{ name: string }>(sql`
        select name from tenants where id = ${tenantId}
      `);
      return {
        rows: documents.rows,
        trips: tripRows.rows,
        tenantName: name.rows[0]?.name ?? 'Workspace',
      };
    },
  );

  const entries: ZipEntry[] = [];
  const index: string[] = [
    'date,supplier,abn,total_inc_gst,gst,is_tax_invoice,gst_claimable,pages,files',
  ];

  const used = new Set<string>();
  for (const row of rows) {
    const date = row.issue_date ?? 'undated';
    // At-risk documents go in a separate folder rather than being dropped.
    // An accountant would rather see a receipt that cannot support a GST
    // credit than not know it existed.
    const folder = row.is_tax_invoice ? 'tax-invoices' : 'receipts-gst-at-risk';
    const pages = row.pages ?? [];

    /**
     * Where this document's files go.
     *
     * A single-page document is a single FILE, exactly as before, so a pack a
     * user already has on disk does not reshape. A multi-page document gets a
     * FOLDER of its own, holding page-01, page-02 in order.
     *
     * The uniqueness suffix goes on the folder, not on the page inside it.
     * Putting it on the page produced `page-01-2.png` sitting next to
     * `page-01.png` in one folder — two DIFFERENT invoices interleaved under a
     * name that claimed they were one document. Two dockets from the same
     * supplier on the same day for the same amount is a real thing at a truck
     * stop, so the collision is expected; what it must never do is merge them.
     */
    const base = `${folder}/${date}-${slug(row.supplier_name ?? 'unknown')}-${row.payable_amount ?? '0'}`;
    const unique = (stem: string, ext: string | null): string => {
      // Reserved on the STEM, so a folder and a file can never collide either.
      let candidate = stem;
      let n = 2;
      while (used.has(candidate)) {
        candidate = `${stem}-${n}`;
        n += 1;
      }
      used.add(candidate);
      return ext === null ? candidate : `${candidate}.${ext}`;
    };

    const written: string[] = [];
    let missing = 0;

    const multi = pages.length > 1;
    const home = multi ? unique(base, null) : null;

    for (const page of pages) {
      const ext = EXTENSIONS[page.mime] ?? 'bin';
      const name =
        home === null
          ? unique(base, ext)
          : `${home}/page-${String(page.pageNumber).padStart(2, '0')}.${ext}`;
      try {
        const bytes = readObject(page.storageKey);
        entries.push({
          name,
          bytes,
          modified: row.issue_date ? new Date(row.issue_date) : undefined,
        });
        written.push(name);
      } catch {
        // Unreadable: keep the row, drop the entry, and SAY so below. A page
        // that vanishes quietly from a five-year record is the failure this
        // whole export exists to prevent.
        missing += 1;
      }
    }

    // One row per DOCUMENT, listing its files — not one row per page, which
    // would make a two-page invoice read as two purchases and double the
    // claimed GST for anyone totalling the column.
    let fileCell =
      written.length === 0
        ? 'ALL PAGES MISSING'
        : written.join(' | ') + (missing > 0 ? ` (${missing} PAGE(S) MISSING)` : '');

    // `captures.page_count` is a stored number and the page rows are the fact.
    // They went out of step once already, when a PDF demuxed into more pages
    // than were declared, so the index reports what is actually IN the pack
    // and flags the disagreement rather than repeating a column that may be
    // stale — an index that overstates a record is worse than one that is
    // merely incomplete.
    if (row.page_count !== pages.length) {
      fileCell += ` (capture records ${row.page_count} page(s))`;
    }

    index.push(
      [
        csv(date),
        csv(row.supplier_name),
        csv(row.supplier_abn),
        csv(row.payable_amount),
        csv(row.tax_amount),
        row.is_tax_invoice ? 'yes' : 'no',
        row.is_tax_invoice ? csv(row.tax_amount) : '0.0000',
        String(pages.length),
        csv(fileCell),
      ].join(','),
    );
  }

  entries.push({ name: 'index.csv', bytes: Buffer.from(index.join('\n'), 'utf8') });

  if (trips.length > 0) {
    const log = ['date,from,to,km,purpose,work_related'];
    for (const t of trips) {
      log.push(
        [
          csv(t.trip_date),
          csv(t.from_place),
          csv(t.to_place),
          csv(t.km),
          csv(t.purpose),
          t.work_related ? 'yes' : 'no',
        ].join(','),
      );
    }
    entries.push({ name: 'trip-log.csv', bytes: Buffer.from(log.join('\n'), 'utf8') });
  }

  entries.push({
    name: 'README.txt',
    bytes: Buffer.from(
      [
        `${tenantName} — records for ${periodLabel}`,
        `Covering ${fromDate} to ${toDate}. Prepared ${new Date().toISOString().slice(0, 10)}.`,
        '',
        'tax-invoices/           Purchases whose paperwork carries every element the ATO',
        '                        requires, so the GST on them can be claimed.',
        'receipts-gst-at-risk/   Purchases that are NOT valid tax invoices. The expense may',
        '                        still be deductible; the GST credit is not supported.',
        'index.csv               Every document above, with what was read off it.',
        '',
        'A document with more than one page gets a FOLDER named for it, holding',
        'page-01, page-02 and so on in order. A single-page document is a single',
        'file. The "pages" column in index.csv states how many pages the record',
        'has, and "files" names every one of them — so a page that failed to',
        'export is visible as a gap rather than being silently absent.',
        'trip-log.csv            Work travel, if any was recorded.',
        '',
        'The images are the originals exactly as captured — not re-encoded, cropped or',
        'enhanced. Under the ATO rules an electronic copy is acceptable only if it is a',
        'true and clear reproduction, so these ARE the records. The CSVs are derived.',
        '',
        'Business records must be kept for five years from the date they were prepared,',
        'obtained or the transaction completed, whichever is latest.',
      ].join('\n'),
      'utf8',
    ),
  });

  const archive = zip(entries);
  // Stored under its own content hash, like any other object, so preparing the
  // same pack twice costs one write and hands back the same file.
  const stored = put(tenantId, archive);
  const digest = createHash('sha256').update(archive).digest('hex').slice(0, 8);

  return {
    key: stored.key,
    filename: `${slug(tenantName)}-${periodLabel.replace(/[^\w]+/g, '-')}-${digest}.zip`,
    bytes: archive.byteLength,
    documentCount: rows.length,
  };
}
