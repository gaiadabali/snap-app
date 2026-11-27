import { describe, expect, it } from 'vitest';

import type { Document } from '@snap/api-contract/docdom';

import { addressFromLayout, headerTextLines } from './merchant-backfill.js';

/** A one-span-per-line DocDOM, laid out top to bottom, over any number of pages. */
function docdom(pages: string[][]): Document {
  const box = (y: number) => ({ x: 10, y, width: 100, height: 10 });
  const prov = { engine: 'test', confidence: 0.99 };
  return {
    version: 1,
    pages: [],
    blocks: pages.map((lines, p) => ({
      id: `b${p}`,
      kind: 'paragraph',
      box: box(0),
      page: p + 1,
      order: p,
      provenance: prov,
      lines: lines.map((text, i) => ({
        id: `l${p}-${i}`,
        box: box(i * 12),
        order: i,
        spans: [{ id: `s${p}-${i}`, text, box: box(i * 12), provenance: prov }],
      })),
    })),
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  } as unknown as Document;
}

describe('backfill from a stored layout (9.5.h)', () => {
  it('reads the merchant address from the first-page header', () => {
    const doc = docdom([
      ['BP TRUCKSTOP', '245 Parramatta Rd', 'HAYMARKET NSW 2000', 'ABN 85 129 887 341', 'Unleaded 45.2L $98.40', 'TOTAL $98.40'],
    ]);
    expect(addressFromLayout(doc)).toEqual({
      line1: '245 Parramatta Rd',
      city: 'Haymarket',
      state: 'NSW',
      postcode: '2000',
    });
  });

  it('never reads below the items: a customer address further down is ignored', () => {
    const doc = docdom([
      ['Joe Cafe', 'ABN 85 129 887 341', 'Flat white $4.50', 'TOTAL $4.50', 'Deliver to Jane Citizen', '9 Private Ln', 'MOSMAN NSW 2088'],
    ]);
    expect(addressFromLayout(doc)).toBeNull();
  });

  it('only looks at the first page', () => {
    const doc = docdom([['Joe Cafe', 'ABN 85 129 887 341'], ['Remit to', 'MOSMAN NSW 2088']]);
    expect(headerTextLines(doc)).toEqual(['Joe Cafe', 'ABN 85 129 887 341']);
    expect(addressFromLayout(doc)).toBeNull();
  });

  it('an empty layout yields nothing', () => {
    expect(headerTextLines(docdom([]))).toEqual([]);
    expect(addressFromLayout(docdom([]))).toBeNull();
  });
});
