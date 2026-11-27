import type { Document } from '@snap/api-contract/docdom';

import { addressFromHeaderLines, headerLines, type MerchantAddress } from './merchant-address.js';

/**
 * The text lines of a stored DocDOM's FIRST page, top to bottom, each line's
 * spans left to right. Only the first page: a multi-page invoice carries the
 * merchant's header on page one, and a later page's lines are exactly the
 * region (totals, remittance, customer block) the address must never be read
 * from.
 */
export function headerTextLines(doc: Document): string[] {
  const firstPage = Math.min(...doc.blocks.map((b) => b.page));
  if (!Number.isFinite(firstPage)) return [];
  return doc.blocks
    .filter((b) => b.page === firstPage)
    .flatMap((b) => b.lines)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
    .map((line) =>
      [...line.spans]
        .sort((a, b) => a.box.x - b.box.x)
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((text) => text !== '');
}

/**
 * The merchant's address as printed in a stored layout's header, or null.
 * Deterministic and model-free: see `addressFromHeaderLines`. Only the header
 * lines (`headerLines`) are ever searched.
 */
export function addressFromLayout(doc: Document): MerchantAddress | null {
  return addressFromHeaderLines(headerLines(headerTextLines(doc)));
}
