import { describe, expect, it } from 'vitest';

import { MUTATION, READ_METHODS, SIDE_EFFECT_ONLY, STATE_CHANGING } from './mutations';

/**
 * Persistence is applied by naming convention, so the convention is tested.
 *
 * `createApi` wraps any method whose name matches `MUTATION` and queues a
 * write after it. That is only sound while the two lists below are true: a
 * mutation that slips past the pattern is a change the user makes and then
 * loses on reload, with nothing on screen to suggest anything went wrong.
 */
describe('persistence by convention', () => {
  it('recognises every method that changes session state', () => {
    const missed = STATE_CHANGING.filter((m) => !MUTATION.test(m));
    expect(missed).toEqual([]);
  });

  it('does not fire on reads', () => {
    // A read that queued a write would rebuild the document delta after every
    // list — a needless hitch while scrolling.
    const wrong = READ_METHODS.filter((m) => MUTATION.test(m));
    expect(wrong).toEqual([]);
  });

  it('lists every method exactly once', () => {
    const all = [...STATE_CHANGING, ...SIDE_EFFECT_ONLY, ...READ_METHODS];
    expect(new Set(all).size).toBe(all.length);
  });
});
