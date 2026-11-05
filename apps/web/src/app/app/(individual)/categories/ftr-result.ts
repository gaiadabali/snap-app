import type { FtrSendResult } from './SendToFtr';

/** The callback's `?ftr=` (a code, never text) back into what to show. */
export function ftrResult(q: { ftr?: string; fy?: string; code?: string }): FtrSendResult | undefined {
  if (q.ftr === 'sent' && q.fy && /^\d{4}-\d{2}$/.test(q.fy)) return { status: 'sent', year: q.fy };
  if (q.ftr === 'cancelled') return { status: 'cancelled' };
  if (q.ftr === 'failed') return { status: 'failed', code: q.code ?? null };
  return undefined;
}
