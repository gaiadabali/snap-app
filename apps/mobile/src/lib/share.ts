import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { DocumentView, Invoice, TaxPackFile } from '@/api';

import { formatAbn, formatAud, formatShortDate } from './format';

/**
 * Getting data out of the app.
 *
 * Two shapes, for two audiences. A CSV goes to an accountant or a
 * spreadsheet, so it carries every field including the ones that decide
 * whether GST is claimable. A PDF goes to a customer, so it is a document
 * rather than a table.
 *
 * Everything is written to the app's cache directory and handed to the OS
 * share sheet. Nothing is emailed from inside the app: an attachment of a
 * client's whole financial year, sent by a process they cannot see, is a
 * disclosure they did not authorise.
 */

/** RFC 4180: quote anything containing a comma, quote or newline. */
function cell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: Array<Array<string | number | null>>): string {
  // A BOM, because Excel on Windows otherwise reads UTF-8 as mojibake and the
  // first thing anyone does with this file is open it in Excel.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

async function shareText(name: string, contents: string, mime: string): Promise<void> {
  if (Platform.OS === 'web') {
    // The share sheet does not exist on web; a download does.
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
  }
}

/**
 * Every document in the period, one row per document.
 *
 * Includes the compliance columns. An accountant's first question about a
 * spending export is which of it can actually be claimed, and answering that
 * from a total alone is impossible.
 */
export async function exportDocumentsCsv(
  docs: DocumentView[],
  label: string,
): Promise<void> {
  const rows: Array<Array<string | number | null>> = [
    [
      'Date',
      'Supplier',
      'ABN',
      'ABN valid',
      'Category',
      'Total incl GST',
      'GST',
      'GST-free',
      'Ex GST',
      'Tax invoice',
      'GST at risk',
      'Compliance issues',
      'Review status',
      'Captured by',
      'Document id',
    ],
  ];
  for (const d of docs) {
    rows.push([
      d.issueDate,
      d.supplierName,
      d.supplierAbn ?? '',
      d.supplierAbn ? (d.supplierAbnValid ? 'yes' : 'no') : '',
      d.category,
      Number(d.payableAmount).toFixed(2),
      Number(d.taxAmount).toFixed(2),
      d.gstFreeAmount ? Number(d.gstFreeAmount).toFixed(2) : '',
      Number(d.taxExclusiveAmount).toFixed(2),
      d.isTaxInvoice ? 'yes' : 'no',
      d.gstAtRisk ? Number(d.gstAtRisk).toFixed(2) : '',
      (d.complianceFailures ?? []).join('; '),
      d.reviewStatus,
      d.capturedByName ?? '',
      d.id,
    ]);
  }
  await shareText(`snap-receipts-${label}.csv`, csv(rows), 'text/csv');
}

/** One row per LINE, for anyone reconciling against a bank feed. */
export async function exportLinesCsv(docs: DocumentView[], label: string): Promise<void> {
  const rows: Array<Array<string | number | null>> = [
    ['Date', 'Supplier', 'Line', 'Description', 'Qty', 'Unit price', 'Amount', 'GST-free', 'Category'],
  ];
  for (const d of docs) {
    for (const l of d.lines) {
      rows.push([
        d.issueDate,
        d.supplierName,
        l.lineNumber,
        l.description,
        l.quantity,
        Number(l.unitPrice).toFixed(2),
        Number(l.amount).toFixed(2),
        l.gstFree ? 'yes' : 'no',
        l.category ?? d.category,
      ]);
    }
  }
  await shareText(`snap-lines-${label}.csv`, csv(rows), 'text/csv');
}

/**
 * An invoice as a PDF, ready to send.
 *
 * Built as HTML and printed, rather than drawn: the layout has to survive
 * being read by a customer's accounts department, and an HTML table does that
 * better than hand-placed text.
 */
export async function shareInvoicePdf(
  invoice: Invoice,
  business: { name: string; abn: string | null },
): Promise<void> {
  const rows = invoice.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td class="n">${l.quantity} ${escapeHtml(l.unit)}</td>
        <td class="n">${formatAud(l.unitPrice)}</td>
        <td class="n">${formatAud(l.netAmount)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Roboto, Helvetica, sans-serif; color:#0A1A2F; padding:40px; }
    h1 { font-size:26px; margin:0 0 2px; letter-spacing:-0.4px; }
    .muted { color:#55677E; font-size:12px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; }
    .box { background:#F2F7FE; border-radius:10px; padding:14px 16px; }
    table { width:100%; border-collapse:collapse; margin-top:22px; font-size:13px; }
    th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.08em;
         color:#55677E; border-bottom:1.5px solid #C9DCF3; padding:0 0 7px; }
    td { padding:9px 0; border-bottom:1px solid #E5EFFC; }
    td.n, th.n { text-align:right; }
    .totals { margin-top:18px; margin-left:auto; width:56%; font-size:13px; }
    .totals div { display:flex; justify-content:space-between; padding:5px 0; }
    .totals .grand { border-top:1.5px solid #0A1A2F; margin-top:6px; padding-top:9px;
                     font-weight:700; font-size:16px; }
    .foot { margin-top:34px; font-size:11px; color:#55677E; line-height:1.6; }
  </style></head><body>
    <div class="head">
      <div>
        <h1>${escapeHtml(business.name)}</h1>
        ${business.abn ? `<div class="muted">ABN ${formatAbn(business.abn)}</div>` : ''}
      </div>
      <div class="box">
        <div style="font-weight:700;font-size:15px">${invoice.kind === 'estimate' ? 'Estimate' : 'Tax invoice'}</div>
        <div class="muted">${escapeHtml(invoice.number)}</div>
      </div>
    </div>

    <div style="display:flex;gap:40px">
      <div><div class="muted">Billed to</div><div style="font-weight:600">${escapeHtml(invoice.partyName)}</div></div>
      <div><div class="muted">Issued</div><div>${formatShortDate(invoice.issueDate)}</div></div>
      <div><div class="muted">Due</div><div>${formatShortDate(invoice.dueDate)}</div></div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${formatAud(invoice.netAmount)}</span></div>
      <div><span>GST 10%</span><span>${formatAud(invoice.gstAmount)}</span></div>
      <div class="grand"><span>Total</span><span>${formatAud(invoice.totalAmount)}</span></div>
      ${
        Number(invoice.amountPaid) > 0
          ? `<div><span>Paid</span><span>${formatAud(invoice.amountPaid)}</span></div>
             <div style="font-weight:700"><span>Due</span><span>${formatAud(invoice.amountDue)}</span></div>`
          : ''
      }
    </div>

    <div class="foot">
      ${
        invoice.kind === 'estimate'
          ? 'This is an estimate, not a tax invoice. Prices are valid for 30 days.'
          : 'Total price includes GST. GST is exactly 1/11 of the GST-inclusive total.'
      }
    </div>
  </body></html>`;

  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: invoice.number });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Saves a prepared tax pack.
 *
 * Fetches the archive from the short-lived link the server issued and hands it
 * to the share sheet, or to a download on web. Nothing is written into the
 * app's own storage permanently: the pack is a copy of records the server
 * already holds, and a second permanent copy on the phone is a second thing to
 * lose.
 */
export async function saveTaxPack(file: TaxPackFile): Promise<void> {
  if (!/^https?:/.test(file.url)) {
    // The demo has no server to fetch from. Said plainly rather than failing
    // with a network error that looks like a bug.
    throw new Error(
      'The pack itself is assembled by the server. In this demo only the CSV exports below are real.',
    );
  }

  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'That link has expired. Prepare the pack again.'
        : `The pack could not be downloaded (${response.status}).`,
    );
  }

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const target = new File(Paths.cache, file.filename);
  if (target.exists) target.delete();
  target.create();
  target.write(new Uint8Array(await response.arrayBuffer()));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri, {
      mimeType: 'application/zip',
      dialogTitle: file.filename,
    });
  }
}
