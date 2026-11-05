'use client';

import { useState } from 'react';

import { Card, buttonClasses } from '@/design/primitives';
import { ftrSendMessage } from '@/lib/auth/yourtal-errors';

/** How the last send ended, read from the callback's redirect (`?ftr=`); the page validates it. */
export type FtrSendResult = { status: 'sent'; year: string } | { status: 'cancelled' } | { status: 'failed'; code: string | null };

/**
 * The download that hands one financial year of deductions to Free Tax Returns.
 * Fetched on click so an error from the API (not allowed, too many tries) is shown
 * as a message, never saved as if it were the file.
 */
export function SendToFtr({
  financialYear,
  href = '/app/deduction-bundle',
  directSend = false,
  result,
  reviewUrl,
}: {
  financialYear: string;
  href?: string;
  /** The server says this person may send straight to Free Tax Returns. */
  directSend?: boolean;
  result?: FtrSendResult;
  reviewUrl?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendDirect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/app/ftr-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ financialYear }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (res.ok && body?.url) {
        window.location.assign(body.url);
        return; // leaving the page: keep the button busy
      }
      setError(body?.message ?? ftrSendMessage(null));
    } catch {
      setError('Could not reach Snap Apps. Check your connection and try again. Nothing was sent.');
    }
    setBusy(false);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${href}?fy=${encodeURIComponent(financialYear)}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not prepare the file. Try again in a moment.');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `snap-deductions-${financialYear}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not prepare the file. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const fileButton = (
    <button type="button" onClick={() => void send()} disabled={busy} className={buttonClasses(directSend ? 'secondary' : 'primary', 'md', directSend ? '!h-auto min-h-11 py-2 text-center' : '!h-auto min-h-11 py-2 text-center')}>
      {directSend ? 'Save as a file instead' : `Send ${financialYear} to Free Tax Returns`}
    </button>
  );

  if (!directSend) {
    return (
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-[14px]">
            Doing your tax return with Free Tax Returns? Download your {financialYear} deductions as a
            file and upload it there. It lists each deduction with its total and a fingerprint of each
            receipt. It has no merchant names, and it does not include the receipt images.
          </p>
          <div className="flex flex-col gap-2">
            {fileButton}
            {error ? <p role="alert" className="text-[13px] text-[var(--color-risk)]">{error}</p> : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-3">
        {result?.status === 'sent' ? (
          <p role="status" className="text-[14px] font-medium">
            Sent. Your {result.year} deductions are waiting in Free Tax Returns.{' '}
            {reviewUrl ? (
              <a href={reviewUrl} className="underline">
                Review them
              </a>
            ) : null}
          </p>
        ) : null}
        {result?.status === 'cancelled' ? (
          <p role="status" className="text-[14px] font-medium">Nothing was sent.</p>
        ) : null}
        {result?.status === 'failed' ? (
          <p role="alert" className="text-[14px] text-[var(--color-risk)]">{ftrSendMessage(result.code)}</p>
        ) : null}
        <p className="max-w-prose text-[14px]">
          Your {financialYear} deductions go straight to Free Tax Returns. YourTal asks you to confirm,
          and nothing in your return changes until you accept it there.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void sendDirect()} disabled={busy} className={buttonClasses('primary', 'md', '!h-auto min-h-11 py-2 text-center')}>
            Send to Free Tax Returns
          </button>
          {fileButton}
        </div>
        {error ? <p role="alert" className="text-[13px] text-[var(--color-risk)]">{error}</p> : null}
      </div>
    </Card>
  );
}
