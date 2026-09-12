import { describe, expect, it } from 'vitest';

import { MODELS, chain, primary } from './router.js';

/**
 * The router's job is to decide which model answers, and the decision that
 * matters most is which models it REFUSES to use.
 *
 * `docs/AI.md` §2.3 excluded DeepSeek from chat on a measurement: it called the
 * tools and then failed to report what they returned, scoring 2/4 where every
 * other candidate scored 4/4. That decision lived only in the document — the
 * registry still listed the model as chat-capable and `chain()` filtered on
 * capability alone, so it sat in the live escalation ladder at tier 2.
 *
 * Nothing failed, because nothing asserted the refusal. That is the same shape
 * as the `rolbypassrls` incident and the unguarded sign-in bypass: a decision
 * written down, believed, and never enforced.
 *
 * These tests assert the NEGATIVE. If someone re-adds the model to the chat
 * chain, this suite is what stops it.
 */

describe('the chat chain honours the exclusions in docs/AI.md', () => {
  it('never offers DeepSeek for chat', () => {
    const ids = chain('chat').map((m) => m.id);
    expect(
      ids.some((id) => id.startsWith('deepseek')),
      'docs/AI.md §2.3 excludes DeepSeek from chat: it reports tool results ' +
        'incorrectly, which makes a wrong tax figure look sanctioned.',
    ).toBe(false);
  });

  it('refuses DeepSeek for chat even when pinned explicitly', () => {
    // A pin is how a replay reproduces a historical run. It must not be a way
    // to reach a model this project has decided is unsafe to serve.
    expect(() => chain('chat', 'deepseek-v4-flash:0731')).toThrow(/excluded from chat/);
  });

  it('keeps the model in the registry, with its reason, rather than deleting it', () => {
    // Deleting it would lose the measurement and invite someone to add it back.
    const deepseek = MODELS.find((m) => m.id === 'deepseek-v4-flash:0731');
    expect(deepseek, 'the model should stay listed so the reason survives').toBeDefined();
    expect(deepseek?.excludedFrom?.chat).toMatch(/AI\.md/);
  });

  it('still has a usable chat chain after the exclusion', () => {
    // An exclusion that empties the chain is an outage, not a safeguard.
    const ids = chain('chat').map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(primary('chat')).toBeDefined();
  });

  it('leaves vision untouched', () => {
    // The exclusion is capability-scoped. Nothing about the vision ladder,
    // which is the one the extraction worker actually uses today, may change.
    const ids = chain('vision').map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(primary('vision').capabilities).toContain('vision');
  });

  it('orders every chain by tier, so escalation goes to a stronger model', () => {
    for (const capability of ['vision', 'chat'] as const) {
      const tiers = chain(capability).map((m) => m.tier);
      expect([...tiers].sort((a, b) => a - b), `${capability} chain is out of order`).toEqual(
        tiers,
      );
    }
  });
});
