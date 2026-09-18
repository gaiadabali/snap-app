/**
 * Header-sniffed column mapping for a CSV statement export.
 *
 * `docs/STATEMENTS.md` §5.6/§12 T5: "Bank CSV exports have no standard...
 * Say what you accept, how you detect the column mapping, and what happens
 * to a file you cannot map — refusing clearly beats guessing a column
 * order." This module is the "how": a small, deterministic vocabulary of
 * header names seen across AU and ID internet-banking exports, scored
 * against the file's actual header row. No machine-learning, no fuzzy
 * scoring beyond exact/substring matches on a normalised header — a wrong
 * guess here silently flips every row's meaning (§5.6), so the bar is
 * "confident" or "refused", never "probably".
 *
 * What this deliberately does NOT do: remember a confirmed mapping per
 * institution across imports. §5.6's "Do:" line names that as the intended
 * shape ("a header-sniffed column mapping the user confirms once per
 * institution"), but there is nowhere to persist it — `financial_accounts`
 * (0031) has no mapping column, and this ticket does not touch migrations or
 * schema. Detection therefore runs fresh on every import; a file whose
 * headers this module cannot place is refused with the headers it saw, so a
 * future confirmation UI has something to show without any server rework.
 */

export type CsvColumn =
  | 'date'
  | 'valueDate'
  | 'description'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'balance';

export interface ColumnMapping {
  date: number;
  valueDate: number | null;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export type ColumnMappingResult =
  | { ok: true; mapping: ColumnMapping }
  | { ok: false; reason: string; headers: string[] };

/**
 * Header vocabulary, normalised lower-case, matched as a WHOLE cell (after
 * trimming and collapsing whitespace) rather than a substring — "date" must
 * not also claim "value date" or "posted date first seen date", each of
 * which is listed in full below instead.
 */
const HEADER_VOCAB: Record<CsvColumn, string[]> = {
  date: [
    'date',
    'transaction date',
    'trans date',
    'txn date',
    'posting date',
    'posted date',
    'process date',
    'tanggal',
    'tanggal transaksi',
    'tgl transaksi',
    'tgl',
  ],
  valueDate: ['value date', 'effective date', 'tanggal efektif'],
  description: [
    'description',
    'narrative',
    'details',
    'transaction details',
    'transaction description',
    'particulars',
    'payee',
    'merchant',
    'memo',
    'reference',
    'keterangan',
    'uraian',
    'uraian transaksi',
  ],
  amount: ['amount', 'transaction amount', 'value', 'jumlah', 'nominal'],
  debit: ['debit', 'debit amount', 'withdrawal', 'withdrawals', 'dr', 'money out', 'mutasi debit'],
  credit: ['credit', 'credit amount', 'deposit', 'deposits', 'cr', 'money in', 'mutasi kredit'],
  balance: [
    'balance',
    'running balance',
    'closing balance',
    'ledger balance',
    'saldo',
    'saldo akhir',
  ],
};

function normaliseHeader(raw: string): string {
  return raw
    .replace(/^﻿/, '') // a stray BOM on the very first header cell
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Maps a CSV's header row to the columns a statement line needs, or refuses.
 *
 * `date`, `description` and (`amount` OR both `debit` and `credit`) are
 * required — anything less and there is no way to build a `statement_lines`
 * row at all. Everything else (`valueDate`, `balance`) is optional and
 * simply absent from the mapping when the file does not carry it.
 */
export function detectColumnMapping(headerRow: string[]): ColumnMappingResult {
  const headers = headerRow.map(normaliseHeader);
  const indexOf = (candidates: string[]): number | null => {
    const i = headers.findIndex((h) => candidates.includes(h));
    return i === -1 ? null : i;
  };

  const date = indexOf(HEADER_VOCAB.date);
  const valueDate = indexOf(HEADER_VOCAB.valueDate);
  const description = indexOf(HEADER_VOCAB.description);
  const amount = indexOf(HEADER_VOCAB.amount);
  const debit = indexOf(HEADER_VOCAB.debit);
  const credit = indexOf(HEADER_VOCAB.credit);
  const balance = indexOf(HEADER_VOCAB.balance);

  const missing: string[] = [];
  if (date === null) missing.push('a date column');
  if (description === null) missing.push('a description column');
  const hasAmount = amount !== null;
  const hasDebitCredit = debit !== null && credit !== null;
  if (!hasAmount && !hasDebitCredit) {
    missing.push('either a single amount column, or both a debit and a credit column');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Could not map this CSV to a statement: missing ${missing.join(' and ')}. ` +
        `Recognised headers found: ${headerRow.map((h) => `"${h}"`).join(', ') || '(none)'}.`,
      headers: headerRow,
    };
  }

  return {
    ok: true,
    mapping: {
      date: date!,
      valueDate,
      description: description!,
      amount,
      debit,
      credit,
      balance,
    },
  };
}
