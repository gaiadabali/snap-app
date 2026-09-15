import { describe, expect, it } from 'vitest';

import { parseDismissedIds, serializeDismissedIds } from './dismissal';

/**
 * `readDismissedIds` / `persistDismissal` need `window.localStorage`, so they
 * are exercised by driving the app in a real browser (see the PR/QA report),
 * not here — `vitest.config.ts` runs this suite under plain Node. What IS
 * unit-testable, and where the actual "wrapped in try/catch, correct on
 * garbage" behaviour lives, is the pure parse/serialize pair below.
 */

describe('parseDismissedIds', () => {
  it('returns [] for null (nothing stored yet)', () => {
    expect(parseDismissedIds(null)).toEqual([]);
  });

  it('returns [] for an empty string', () => {
    expect(parseDismissedIds('')).toEqual([]);
  });

  it('returns [] for malformed JSON rather than throwing', () => {
    expect(parseDismissedIds('{not json')).toEqual([]);
  });

  it('returns [] for valid JSON that is not an array', () => {
    expect(parseDismissedIds('{"a":1}')).toEqual([]);
    expect(parseDismissedIds('42')).toEqual([]);
    expect(parseDismissedIds('"just-a-string"')).toEqual([]);
  });

  it('parses a real dismissed list', () => {
    expect(parseDismissedIds('["ad-1","ad-2"]')).toEqual(['ad-1', 'ad-2']);
  });

  it('drops non-string entries instead of throwing', () => {
    expect(parseDismissedIds('["ad-1", 2, null, "ad-2"]')).toEqual(['ad-1', 'ad-2']);
  });
});

describe('serializeDismissedIds', () => {
  it('round-trips through parseDismissedIds', () => {
    const ids = ['ad-1', 'ad-2', 'ad-3'];
    expect(parseDismissedIds(serializeDismissedIds(ids))).toEqual(ids);
  });

  it('serialises an empty list', () => {
    expect(serializeDismissedIds([])).toBe('[]');
  });
});
