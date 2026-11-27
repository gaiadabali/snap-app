import { describe, expect, it } from 'vitest';

import { mimeOrDefault, safeFileName } from './mail-files';

describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('statement-nov.pdf')).toBe('statement-nov.pdf');
    expect(safeFileName('Résumé 2026.docx')).toBe('Résumé 2026.docx');
  });

  it('drops any path a sender put in the name', () => {
    expect(safeFileName('../../../data/evil.apk')).toBe('evil.apk');
    expect(safeFileName(String.raw`C:\Windows\win.ini`)).toBe('win.ini');
    expect(safeFileName('/etc/passwd')).toBe('passwd');
  });

  it('replaces control and reserved characters, and leading dots', () => {
    expect(safeFileName('a\u0000b\nc.txt')).toBe('a_b_c.txt');
    expect(safeFileName('x<y>:z?.txt')).toBe('x_y__z_.txt');
    expect(safeFileName('...hidden')).toBe('hidden');
  });

  it('never returns an empty name', () => {
    for (const n of ['', '   ', '...', '/', '../']) expect(safeFileName(n)).toBe('attachment');
  });

  it('cuts a very long name but keeps the extension', () => {
    const out = safeFileName(`${'a'.repeat(300)}.pdf`);
    expect(out).toHaveLength(100);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('mimeOrDefault', () => {
  it('passes a real type through, lower-cased', () => {
    expect(mimeOrDefault('Application/PDF')).toBe('application/pdf');
    expect(mimeOrDefault('image/svg+xml')).toBe('image/svg+xml');
  });
  it('falls back for anything missing or malformed', () => {
    for (const t of [null, undefined, '', 'pdf', 'text/', 'a b/c', 'text/html; charset=x']) {
      expect(mimeOrDefault(t)).toBe('application/octet-stream');
    }
  });
});
