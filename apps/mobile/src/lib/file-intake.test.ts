import { describe, expect, it } from 'vitest';

import {
  assertFilePickAllowed,
  assertWithinUploadLimit,
  classifyPickedFile,
  MAX_UPLOAD_BYTES,
  resolvePickedMimeType,
} from './file-intake';

/**
 * T6 — `docs/STATEMENTS.md` §5.6 / §12. "Done when: a person can select a PDF
 * or CSV from their phone and have it enter the same capture pipeline a
 * photo does, and a test asserts it." `capture.tsx` itself is a screen and is
 * verified by driving the built app; this covers the decisions it delegates
 * here.
 */

describe('assertWithinUploadLimit', () => {
  it('allows a file under the 32 MB Fastify bodyLimit', () => {
    expect(() => assertWithinUploadLimit(MAX_UPLOAD_BYTES - 1)).not.toThrow();
    expect(() => assertWithinUploadLimit(MAX_UPLOAD_BYTES)).not.toThrow();
  });

  it('refuses a file over the cap, naming the cap in the message', () => {
    expect(() => assertWithinUploadLimit(MAX_UPLOAD_BYTES + 1)).toThrow(/32\.0 MB/);
  });

  it('names the file size too, not just the cap', () => {
    // 40 MB — the size STATEMENTS.md §5.6 says a real annual statement can
    // reach, well past what a single PUT can physically deliver.
    const fortyMb = 40 * 1024 * 1024;
    expect(() => assertWithinUploadLimit(fortyMb)).toThrow(/40\.0 MB/);
  });
});

describe('assertFilePickAllowed', () => {
  it('allows picking a file into an empty tray', () => {
    expect(() => assertFilePickAllowed(0)).not.toThrow();
  });

  it('refuses to let a file join a tray that already holds photographed pages', () => {
    // The server's own rule: "A PDF must be the only page in its capture."
    // This is the client-side half — refused before the picker even opens.
    expect(() => assertFilePickAllowed(1)).toThrow(/only page/);
    expect(() => assertFilePickAllowed(3)).toThrow(/only page/);
  });
});

describe('classifyPickedFile', () => {
  it('trusts a specific reported MIME type over the extension', () => {
    expect(classifyPickedFile('application/pdf', 'statement.pdf')).toBe('pdf');
    expect(classifyPickedFile('text/csv', 'export.csv')).toBe('csv');
    expect(classifyPickedFile('image/jpeg', 'receipt.jpg')).toBe('image');
  });

  it('falls back to the extension when the reported type is missing or generic', () => {
    // The exact case §5.6 and the ticket both call out: some Android content
    // providers hand back nothing, or `application/octet-stream`, for a CSV
    // exported from internet banking.
    expect(classifyPickedFile(undefined, 'anz-statement.csv')).toBe('csv');
    expect(classifyPickedFile(null, 'anz-statement.csv')).toBe('csv');
    expect(classifyPickedFile('application/octet-stream', 'anz-statement.csv')).toBe('csv');
    expect(classifyPickedFile('application/octet-stream', 'statement.pdf')).toBe('pdf');
  });

  it('only trusts vnd.ms-excel as a CSV misreport when the name agrees', () => {
    expect(classifyPickedFile('application/vnd.ms-excel', 'export.csv')).toBe('csv');
    // A genuine .xls is not a CSV — this must NOT be reclassified.
    expect(classifyPickedFile('application/vnd.ms-excel', 'ledger.xls')).toBe('other');
  });

  it('is case-insensitive on both the MIME type and the extension', () => {
    expect(classifyPickedFile('APPLICATION/PDF', 'Statement.PDF')).toBe('pdf');
    expect(classifyPickedFile(undefined, 'EXPORT.CSV')).toBe('csv');
  });

  it('returns other for a format nobody has named a reader for', () => {
    // §5.6: "Mode (b) ... is not specified and should not stay that way.
    // Either it resolves to a listed format or it is not an intake mode."
    expect(classifyPickedFile('application/zip', 'archive.zip')).toBe('other');
    expect(classifyPickedFile(undefined, 'notes.docx')).toBe('other');
  });
});

describe('resolvePickedMimeType', () => {
  it('declares a PDF and a CSV by their real type, even when misreported', () => {
    expect(resolvePickedMimeType('application/octet-stream', 'statement.pdf')).toBe(
      'application/pdf',
    );
    expect(resolvePickedMimeType('application/octet-stream', 'export.csv')).toBe('text/csv');
  });

  it('never declares a CSV as application/pdf to slip past server validation', () => {
    // The server's DTO only accepts image/* or application/pdf today (T5 is
    // not built) — the honest outcome is the server's own 400, not a CSV
    // wearing a PDF's mimeType to get past the gate.
    const declared = resolvePickedMimeType(undefined, 'export.csv');
    expect(declared).not.toBe('application/pdf');
    expect(declared).toBe('text/csv');
  });

  it('passes an image mimeType through unchanged', () => {
    expect(resolvePickedMimeType('image/heic', 'IMG_0001.heic')).toBe('image/heic');
  });

  it('falls back to octet-stream for an unrecognised format rather than guessing', () => {
    expect(resolvePickedMimeType(undefined, 'notes.docx')).toBe('application/octet-stream');
  });
});
