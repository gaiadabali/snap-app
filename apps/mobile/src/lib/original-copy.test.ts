import { describe, expect, it } from 'vitest';

import { isPdfOriginal, originalCopy } from './original-copy';

const DEMO_COPY = 'this demo ships no photographs';

describe('originalCopy', () => {
  it('never tells a live user the demo ships no photographs', () => {
    for (const photo of [true, false]) {
      for (const pdf of [true, false]) {
        expect(originalCopy({ photo, pdf, demo: false }).caption).not.toContain(DEMO_COPY);
      }
    }
  });

  it('keeps the demo wording in demo mode, for a non-PDF with no photograph', () => {
    const c = originalCopy({ photo: false, pdf: false, demo: true });
    expect(c.chip).toBe('Facsimile');
    expect(c.caption).toContain(DEMO_COPY);
  });

  it('labels a PDF as a PDF, whether or not its page preview loaded', () => {
    expect(originalCopy({ photo: true, pdf: true, demo: false })).toMatchObject({ chip: 'PDF' });
    expect(originalCopy({ photo: false, pdf: true, demo: false }).caption).toContain('Original PDF');
  });

  it('a live image that failed says so plainly', () => {
    const c = originalCopy({ photo: false, pdf: false, demo: false });
    expect(c.caption).toContain('could not be shown');
  });
});

describe('isPdfOriginal', () => {
  it('is true for rasterised-PDF pages only', () => {
    expect(isPdfOriginal({ pages: [{ pageNumber: 1, imageUrl: 'x', source: 'pdf_native' }] })).toBe(true);
    expect(isPdfOriginal({ pages: [{ pageNumber: 1, imageUrl: 'x', source: 'capture' }] })).toBe(false);
  });
});
