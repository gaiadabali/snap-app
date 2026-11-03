import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '@/api';
import type { LinkLoad } from '@/components/YourtalLinkPanel';
import type { LinkContext } from '@/lib/yourtal-link';
import { hasPendingVoucher, looksLikeVoucherCode, type VoucherOutcome } from '@/lib/yourtal-voucher';

/**
 * The YourTal link, loaded and acted on (`GET / POST / DELETE /v1/yourtal/link`).
 *
 * Reloads whenever the screen using it comes into focus, so a link made on
 * another device, or ended in YourTal, shows up without a restart. A reload
 * that fails keeps what was already on screen: a dropped connection should not
 * replace a linked account's numbers with an error.
 *
 * `link` and `unlink` resolve to whether they worked. A failure is kept as
 * `error`, carrying the server's `error` code (or none, for a network failure)
 * for `linkErrorMessage` to turn into a sentence.
 */
export function useYourtalLink() {
  const [load, setLoad] = useState<LinkLoad>({ kind: 'loading' });
  const [busy, setBusy] = useState<LinkContext | null>(null);
  const [error, setError] = useState<{ context: LinkContext; code: string | null } | null>(null);

  const [voucherBusy, setVoucherBusy] = useState(false);
  const [outcome, setOutcome] = useState<VoucherOutcome | null>(null);

  const reload = useCallback(async () => {
    try {
      const status = await api().getYourtalLink(true);
      setLoad({ kind: 'ready', status });
    } catch {
      setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'error' }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    void reload();
  }, [reload]);

  const run = useCallback(
    async (context: LinkContext, call: () => Promise<unknown>): Promise<boolean> => {
      setBusy(context);
      setError(null);
      try {
        await call();
        await reload();
        return true;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : null;
        setError({ context, code });
        // The server and this screen disagree about whether it is linked.
        if (code === 'already_linked') void reload();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const redeem = useCallback(async (typed: string): Promise<boolean> => {
    if (!looksLikeVoucherCode(typed)) {
      setOutcome({ kind: 'error', code: 'invalid_voucher_code' });
      return false;
    }
    setVoucherBusy(true);
    setOutcome(null);
    try {
      const { state, redemption } = await api().redeemYourtalVoucher(typed);
      setOutcome(state === 'granted' ? { kind: 'granted', credits: redemption.credits } : { kind: 'pending' });
      await reload();
      return true;
    } catch (e) {
      setOutcome({
        kind: 'error',
        code: e instanceof ApiError ? e.code : null,
        redeemedAt: e instanceof ApiError ? e.redeemedAt : null,
      });
      return false;
    } finally {
      setVoucherBusy(false);
    }
  }, [reload]);

  // A pending redemption is finished by the server within a minute or so: look again every 5 s.
  const pending = load.kind === 'ready' && hasPendingVoucher(load.status.vouchers);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [pending, reload]);
  // When it finishes, say so (the newest redemption is the one just made).
  useEffect(() => {
    if (outcome?.kind !== 'pending' || pending || load.kind !== 'ready') return;
    const done = load.status.vouchers?.redemptions[0];
    setOutcome(done?.state === 'granted' ? { kind: 'granted', credits: done.credits } : { kind: 'error', code: 'yourtal_unavailable' });
  }, [outcome, pending, load]);

  const link = useCallback((code: string) => run('link', () => api().linkYourtal(code)), [run]);
  const unlink = useCallback(() => run('unlink', () => api().unlinkYourtal()), [run]);
  const clearError = useCallback(() => setError(null), []);

  const clearOutcome = useCallback(() => setOutcome(null), []);

  return { load, busy, error, retry, link, unlink, clearError, redeem, voucherBusy, outcome, clearOutcome };
}
