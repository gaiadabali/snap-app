/**
 * Hand-assembled multi-page PDFs with a real text layer, for the mailed
 * statement tests (Spambank T12). Modelled on `statement-caps.e2e.test.ts`'s
 * builder. `statement-event.test.ts` proves the existing classifier calls them
 * statements, so an e2e failure is never the fixture's.
 */

/** A small, real, multi-page PDF with a text layer the statement classifier recognises. */
export function statementPdf(pageCount: number, salt: string): Buffer {
  const streams = Array.from({ length: pageCount }, (_, i) => {
    // Each line ends in a full stop: pdfjs joins a page's text items with nothing
    // between them (and trims a trailing space), and "...12345678Opening balance"
    // has no word boundary before "Opening", so the classifier would miss the
    // balance pair and the account number.
    const lines = [
      `Bank statement ${salt} page ${i + 1} of ${pageCount}.`,
      'Account number 062-000 12345678.',
      'Opening balance 1,000.00   Closing balance 1,850.00.',
    ];
    return lines
      .map((t, n) => `BT /F1 10 Tf 20 ${270 - n * 14} Td (${t.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`)
      .join('\n');
  });
  const pageIds = streams.map((_, i) => 4 + i * 2);
  const objs: string[] = [];
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  streams.forEach((stream, i) => {
    objs[pageIds[i]! - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objs[pageIds[i]!] = `<< /Length ${stream.length} >> stream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj ${body} endobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
