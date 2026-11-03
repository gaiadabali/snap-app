'use client';

import { useEffect, useState, useTransition } from 'react';
import type { YourtalLinkStatus } from '@snap/api-contract';

import type { VoucherActionResult, YourtalActionResult } from '@/lib/panels/yourtal-actions';
import { hasPendingVoucher, looksLikeVoucherCode, type VoucherOutcome } from '@/lib/yourtal-voucher';
import type { LinkContext } from '@/lib/yourtal-link';
import { YourtalLinkView, type LinkLoad } from './YourtalLinkView';

/**
 * Owns what changes on the page: the status (replaced by each answer from the
 * server), the code being typed, the unlink confirm step and the last error.
 * Everything it shows comes from `YourtalLinkView`.
 *
 * Link and unlink are server actions bound to this page's path, passed in so
 * this component never touches the API (the session token is an httpOnly
 * cookie, `lib/api/server.ts`).
 */
export function YourtalLinkClient({
  initial,
  links,
  retryHref,
  verifyEmailHref,
  onLink,
  onUnlink,
  workspaceName,
  onRedeem,
  onRefresh,
}: {
  /** What the server read for this render. */
  initial: LinkLoad;
  links: { getCode: string; wallet: string; passkey: string };
  retryHref: string;
  verifyEmailHref: string;
  onLink: (code: string) => Promise<YourtalActionResult>;
  onUnlink: () => Promise<YourtalActionResult>;
  /** The workspace the voucher's scans go to. */
  workspaceName: string;
  onRedeem: (code: string) => Promise<VoucherActionResult>;
  /** Reads the status again (a pending redemption finishes on the server). */
  onRefresh: () => Promise<YourtalLinkStatus | null>;
}) {
  const [load, setLoad] = useState<LinkLoad>(initial);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<LinkContext | null>(null);
  const [error, setError] = useState<{ context: LinkContext; code: string | null } | null>(null);
  const [, startTransition] = useTransition();
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [outcome, setOutcome] = useState<VoucherOutcome | null>(null);

  // A pending redemption is finished by the server within a minute or so: look again every 5 s.
  const pending = load.kind === 'ready' && hasPendingVoucher(load.status.vouchers);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void onRefresh().then((status) => {
        if (!status) return;
        setLoad({ kind: 'ready', status });
        if (!hasPendingVoucher(status.vouchers)) {
          const done = status.vouchers?.redemptions[0];
          setOutcome(done?.state === 'granted' ? { kind: 'granted', credits: done.credits } : { kind: 'error', code: 'yourtal_unavailable' });
        }
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, onRefresh]);

  function redeem(typed: string) {
    if (!looksLikeVoucherCode(typed)) {
      setOutcome({ kind: 'error', code: 'invalid_voucher_code' });
      return;
    }
    setVoucherBusy(true);
    setOutcome(null);
    startTransition(async () => {
      const result = await onRedeem(typed);
      setVoucherBusy(false);
      if (!result.ok) return setOutcome({ kind: 'error', code: result.code, redeemedAt: result.redeemedAt });
      if (result.status) setLoad({ kind: 'ready', status: result.status });
      setVoucherCode('');
      setOutcome(
        result.result.state === 'granted'
          ? { kind: 'granted', credits: result.result.redemption.credits }
          : { kind: 'pending' },
      );
    });
  }

  function run(context: LinkContext, call: () => Promise<YourtalActionResult>, done: () => void) {
    setBusy(context);
    setError(null);
    startTransition(async () => {
      const result = await call();
      setBusy(null);
      if (result.ok) {
        setLoad({ kind: 'ready', status: result.status satisfies YourtalLinkStatus });
        done();
      } else {
        setError({ context, code: result.code });
      }
    });
  }

  return (
    <YourtalLinkView
      load={load}
      links={links}
      retryHref={retryHref}
      verifyEmailHref={verifyEmailHref}
      code={code}
      onCodeChange={(v) => {
        setCode(v);
        if (error) setError(null);
      }}
      onLink={(c) => run('link', () => onLink(c), () => setCode(''))}
      voucher={{
        workspaceName,
        code: voucherCode,
        onCodeChange: (v) => {
          setVoucherCode(v);
          if (outcome?.kind === 'error') setOutcome(null);
        },
        onSubmit: redeem,
        busy: voucherBusy,
        outcome,
      }}
      busy={busy}
      error={error}
      confirming={confirming}
      onAskUnlink={() => {
        setError(null);
        setConfirming(true);
      }}
      onCancelUnlink={() => setConfirming(false)}
      // Stays on the confirm step when it fails, so the error shows and Unlink can be tried again.
      onConfirmUnlink={() => run('unlink', onUnlink, () => setConfirming(false))}
    />
  );
}
