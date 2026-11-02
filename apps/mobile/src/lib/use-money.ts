import { useCallback, useMemo } from 'react';

import { useWorkspace } from '@/workspace';
import { currencyDecimals, currencySymbol, formatMoney } from './format';

/**
 * Money formatting bound to a currency, so a screen does not each re-derive it.
 *
 * Which currency an amount is in:
 *   - a document or transaction carries its own: `useMoney(doc.currency)`;
 *   - a workspace total (home, reports, invoices, items…) uses the active
 *     workspace's `baseCurrency`: `useMoney()`;
 *   - SnapApp's own prices stay AUD (we charge in AUD) and use `formatAud`.
 *
 * With no override the currency is AUD while the workspace's is unknown (a
 * server that predates `baseCurrency`, or the context's fallback before the
 * list loads), which is what every workspace was before this existed.
 */
export function useMoney(currency?: string | null) {
  const { active } = useWorkspace();
  const code = currency || active.baseCurrency || 'AUD';

  const fmt = useCallback(
    (value: string | null | undefined, opts?: { cents?: boolean }) => formatMoney(value, code, opts),
    [code],
  );

  return useMemo(
    () => ({
      /** ISO 4217 code every amount from `fmt` is shown in. */
      currency: code,
      fmt,
      /** Prefix for an amount input: `$`, `Rp`, else the code. */
      symbol: currencySymbol(code),
      /** Decimal places to prefill an amount input with: 0 for rupiah, else 2. */
      decimals: currencyDecimals(code),
    }),
    [code, fmt],
  );
}
