/**
 * Turning raw uploaded bytes into rows, before any column mapping happens.
 *
 * `docs/STATEMENTS.md` §5.6 names encoding as one of the "ordinary hazards"
 * that "each needs a decision rather than a default": non-UTF-8 exports,
 * BOMs, and semicolon delimiters from locales where the comma is the decimal
 * mark. The decision made here: UTF-8 (with or without a BOM) is the only
 * encoding this reads. A file that decodes with replacement characters is
 * refused by name rather than imported as silently corrupted text — legacy
 * bank exports in another encoding (Windows-1252, Shift-JIS, ...) are a
 * real gap, stated as a follow-up in the T5 report, not solved here.
 */
import { parse as parseCsvSync } from 'csv-parse/sync';

export type DecodedCsv = { ok: true; text: string } | { ok: false; reason: string };

const REPLACEMENT_CHARACTER = '�';

export function decodeCsvBytes(bytes: Buffer): DecodedCsv {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'That file is empty.' };
  }
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1); // strip the UTF-8 BOM some exports prepend
  }
  if (text.includes(REPLACEMENT_CHARACTER)) {
    return {
      ok: false,
      reason:
        "That file could not be read as UTF-8 text. Re-export the statement as UTF-8 CSV — " +
        'this app does not yet support other text encodings.',
    };
  }
  return { ok: true, text };
}

/**
 * Comma vs semicolon, sniffed from the header line rather than assumed.
 *
 * A European-locale export that uses `,` as the decimal mark commonly
 * delimits fields with `;` instead — counting which character appears more
 * often on the header row is a cheap, reliable enough signal, since a real
 * header never contains the delimiter itself inside a field name.
 */
export function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

export type ParsedRows = { ok: true; rows: string[][] } | { ok: false; reason: string };

/** Thin, deliberately dumb wrapper: quoting, embedded newlines and escaped
 *  quotes are `csv-parse`'s job — this app's own money is better spent on the
 *  bank-format ambiguity that follows, not re-proving RFC 4180. */
export function parseCsvRows(text: string, delimiter: ',' | ';'): ParsedRows {
  try {
    const rows = parseCsvSync(text, {
      delimiter,
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, reason: `Could not parse this file as CSV: ${(error as Error).message}` };
  }
}
