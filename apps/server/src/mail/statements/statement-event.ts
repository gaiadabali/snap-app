/**
 * The `spambank-statement` event YourTal sends (spambank/BUILD.md §5.5;
 * yourtal `packages/contracts/src/spambank/events.ts`,
 * `spambankStatementEventSchema`), read defensively, and the small pure
 * decisions the import makes about one attached file. No I/O here.
 *
 *   {"urn:yourtal:event:spambank-statement": {
 *     "email_id": "Mabc123", "received_at": "2026-11-28T01:02:03Z",
 *     "attachments": [{"blob_id": "Gxyz", "name": "statement-nov.pdf",
 *                      "type": "application/pdf", "size": 183422}]}}
 */

/** BUILD.md §4.8: each offered file is at most 10 MB (YourTal's `STATEMENT_MAX_BYTES`). */
export const MAILED_STATEMENT_MAX_BYTES = 10 * 1024 * 1024;
/** BUILD.md §4.8: at most 10 files per message. */
export const MAILED_STATEMENT_MAX_FILES = 10;

/** YourTal's `JMAP_ID_PATTERN`, with its length bound: the ids go into request bodies and a CHECK (0062). */
const JMAP_ID = /^[A-Za-z0-9_-]{1,255}$/;

export type OfferedFile = { blobId: string; name: string; type: string; size: number };
export type StatementEvent = { emailId: string; receivedAt: string; files: OfferedFile[] };

/** The event's body, or null when it is not the contract's shape (the whole event is then dropped). */
export function parseStatementEvent(body: Record<string, unknown>): StatementEvent | null {
  const { email_id: emailId, received_at: receivedAt, attachments } = body;
  if (typeof emailId !== 'string' || !JMAP_ID.test(emailId)) return null;
  if (typeof receivedAt !== 'string' || receivedAt.length > 40 || Number.isNaN(Date.parse(receivedAt))) return null;
  if (!Array.isArray(attachments) || attachments.length < 1 || attachments.length > MAILED_STATEMENT_MAX_FILES) return null;

  const files: OfferedFile[] = [];
  const seen = new Set<string>();
  for (const raw of attachments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { blob_id: blobId, name, type, size } = raw as Record<string, unknown>;
    if (typeof blobId !== 'string' || !JMAP_ID.test(blobId)) return null;
    if (typeof name !== 'string' || name.length > 255) return null;
    if (typeof type !== 'string' || type.length < 1 || type.length > 127) return null;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return null;
    // The same blob twice in one message is one file.
    if (seen.has(blobId)) continue;
    seen.add(blobId);
    files.push({ blobId, name, type: type.toLowerCase(), size });
  }
  return { emailId, receivedAt: new Date(receivedAt).toISOString(), files };
}

const CSV_TYPES = new Set(['text/csv', 'application/csv', 'text/comma-separated-values']);

/** What the offer says the file is (BUILD.md §4.8 step 2: by type, or by a `.pdf`/`.csv` name). */
export function declaredKind(file: Pick<OfferedFile, 'name' | 'type'>): 'pdf' | 'csv' | null {
  const type = file.type.split(';')[0]!.trim().toLowerCase();
  const name = file.name.trim().toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (CSV_TYPES.has(type) || name.endsWith('.csv')) return 'csv';
  return null;
}

/**
 * What the bytes are. A PDF is recognised by its own header, never by the
 * mail's say-so; anything offered as a CSV that does not start like a PDF is
 * handed to the CSV reader, which refuses what it cannot read.
 */
export function actualKind(declared: 'pdf' | 'csv', bytes: Buffer): 'pdf' | 'csv' | null {
  // The header may follow a little junk (ISO 32000 allows up to 1024 bytes).
  const isPdf = bytes.subarray(0, 1024).includes('%PDF-');
  if (isPdf) return 'pdf';
  return declared === 'csv' ? 'csv' : null;
}

/** pdfjs-dist's refusal of an encrypted PDF it has no password for. */
export function isPasswordError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'PasswordException');
}

/** A file name safe to store and show: no control characters, at most 255 characters, null when empty. */
export function cleanFileName(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return cleaned || null;
}

/** `code` or `code: words`, at most 500 characters (0062's CHECK and YourTal's `detail`). */
export function detailText(code: string, words?: string | null): string {
  const text = words ? `${code}: ${words.replace(/\s+/g, ' ').trim()}` : code;
  return text.slice(0, 500);
}

/** The code part of a stored detail. */
export function reasonOf(detail: string | null): { reason: string | null; message: string | null } {
  if (!detail) return { reason: null, message: null };
  const at = detail.indexOf(': ');
  return at === -1 ? { reason: detail, message: null } : { reason: detail.slice(0, at), message: detail.slice(at + 2) };
}
