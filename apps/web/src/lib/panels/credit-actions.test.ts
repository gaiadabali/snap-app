import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/server', () => ({
  ApiError: class ApiError extends Error {},
  newIdempotencyKey: () => 'key',
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === '/v1/credits/purchases') return { id: 'p1', status: 'pending' };
    return { purchaseId: 'p1', provider: 'stripe', state: 'redirect', url: 'https://pay.test/cs_1' };
  }),
}));

import { purchaseCredits } from './credit-actions';

/**
 * Group task 7.5: every web purchase, from /app/credits as from
 * /app/credits/buy, goes on to the checkout. No pending-only orders.
 */
describe('purchaseCredits', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('records the order, then asks for the checkout and hands back its URL', async () => {
    const result = await purchaseCredits('ws1', '/app/credits', 'credits_50');
    expect(calls).toEqual(['/v1/credits/purchases', '/v1/credits/purchases/p1/checkout']);
    expect(result).toEqual({
      ok: true,
      session: { purchaseId: 'p1', provider: 'stripe', state: 'redirect', url: 'https://pay.test/cs_1' },
    });
  });
});
