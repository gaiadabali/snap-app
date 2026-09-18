/**
 * T6 — a handset can open a file at all.
 *
 * `docs/STATEMENTS.md` §5.6 and §12 T6: D-S3 settled on four intake modes —
 * uploaded PDF, uploaded file, CSV, and camera. On a phone only the camera
 * had a route in (`capture.tsx`'s `shoot()` went straight to
 * `camera.current?.takePictureAsync` outside web), so three of the four
 * decided modes had no client. This module is the PURE part of closing that
 * gap: the checks a picked file must pass before it is allowed to become a
 * `TrayPage` and enter the same `createCapture` / upload / `awaitExtraction`
 * path a photographed page already uses.
 *
 * Deliberately free of any `expo-*` or `react-native` import. `capture.tsx`
 * is a screen, and per `vitest.config.ts`'s own rule screens are verified by
 * driving the built app, not unit-tested here — but the decisions a screen
 * makes about a picked file (is it too big, is it allowed to mix with what
 * is already in the tray, what MIME type does it really carry) are ordinary
 * arithmetic and belong where they can run under plain Vitest.
 */

/**
 * The Fastify `bodyLimit` set in `apps/server/src/main.ts` — 32 MB, restated
 * here rather than imported because the server is not a package this app may
 * depend on (`test/boundaries.test.ts`). A single `PUT` to
 * `/v1/uploads/:token` cannot physically deliver more bytes than this
 * regardless of what the client sends, and `docs/STATEMENTS.md` T7 records
 * that the server's own page-size DTO cap was deliberately NOT raised past
 * ~30 MB for exactly this reason — raising it would advertise a ceiling the
 * transport already refuses to honour. A file over this limit must be
 * refused HERE, before a byte is hashed or an upload attempted, with a
 * message that names the cap — "silence at the boundary" is the failure
 * mode T7 named and this is the same rule applied client-side.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** "34.2 MB" — for a message that names the cap, not just a byte count. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Refuses a file above the transport's byte ceiling.
 *
 * Thrown, not returned, so every caller gets the same "stop and show this"
 * shape the rest of `capture.tsx`'s error handling already expects.
 */
export function assertWithinUploadLimit(byteLength: number): void {
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That file is ${formatMegabytes(byteLength)} — larger than the ${formatMegabytes(MAX_UPLOAD_BYTES)} this app can upload. ` +
        'Try a smaller export, or split the PDF into parts.',
    );
  }
}

/**
 * A PDF must be the only page in its capture — an existing server rule
 * (`captures.controller.ts`: "A PDF must be the only page in its capture").
 * This applies the same constraint to any picked file, CSV included: a bank
 * statement or CSV export is a whole document, not one page of a
 * photographed one, and letting someone assemble a tray of camera pages plus
 * a statement file would only be discovered as an error after the upload.
 *
 * Refuses BEFORE the picker even opens when the tray already holds
 * photographed pages; the reverse direction (adding a camera page once a
 * file has been picked) never arises because a picked file is registered and
 * uploaded immediately rather than joining the tray — see `capture.tsx`.
 */
export function assertFilePickAllowed(pagesAlreadyHeld: number): void {
  if (pagesAlreadyHeld > 0) {
    throw new Error(
      'A PDF, CSV or other file must be the only page in its capture. Finish or clear the pages already added first.',
    );
  }
}

/** Recognised shapes a picked file can resolve to. */
export type PickedFileKind = 'pdf' | 'csv' | 'image' | 'other';

/**
 * What kind of file was picked, from its reported MIME type and its name.
 *
 * The reported type wins whenever it is specific. The extension is the
 * fallback, never the first choice — but it has to exist, because some
 * Android content providers hand back a generic or absent `mimeType` for a
 * CSV exported from internet banking (`application/octet-stream`, or
 * nothing at all) while the file name still carries `.csv`.
 */
export function classifyPickedFile(
  reportedMimeType: string | null | undefined,
  fileName: string | null | undefined,
): PickedFileKind {
  const type = (reportedMimeType ?? '').toLowerCase().trim();
  const name = (fileName ?? '').toLowerCase();

  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/csv' || type === 'text/comma-separated-values' || type === 'application/csv') {
    return 'csv';
  }
  // `application/vnd.ms-excel` is genuinely a legacy .xls MIME type, but some
  // Android providers also report it for a .csv they have mis-sniffed as a
  // spreadsheet — only trusted as CSV here when the name agrees.
  if (type === 'application/vnd.ms-excel' && name.endsWith('.csv')) return 'csv';
  if (type.startsWith('image/')) return 'image';

  const ext = name.split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext && ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp'].includes(ext)) {
    return 'image';
  }
  return 'other';
}

/**
 * The wire `mimeType` to declare for a picked file's `CapturePageInput`.
 *
 * Reports the file's REAL type rather than whatever gets it past
 * validation. The server's DTO only accepts `image/*` or `application/pdf`
 * today (`captures.controller.ts`'s `CapturePageInputDto.mimeType` regex);
 * CSV is not accepted there yet — `docs/STATEMENTS.md` T5, the server-side
 * ticket this depends on, is not built. Declaring a CSV as `text/csv` means
 * the server refuses it with a clear "mimeType must be an image type or
 * application/pdf" 400 today, which is the honest outcome; declaring it as
 * `application/pdf` to sneak past that check would make a CSV masquerade as
 * a PDF the moment T5 ships a reader that trusts this field.
 */
export function resolvePickedMimeType(
  reportedMimeType: string | null | undefined,
  fileName: string | null | undefined,
): string {
  const kind = classifyPickedFile(reportedMimeType, fileName);
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'csv') return 'text/csv';
  if (kind === 'image') return reportedMimeType || 'image/jpeg';
  return reportedMimeType || 'application/octet-stream';
}
