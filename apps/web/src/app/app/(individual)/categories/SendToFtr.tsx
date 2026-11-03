'use client';

import { useState } from 'react';

import { Card, buttonClasses } from '@/design/primitives';

/**
 * The download that hands one financial year of deductions to Free Tax Returns.
 * Fetched on click so an error from the API (not allowed, too many tries) is shown
 * as a message, never saved as if it were the file.
 */
export function SendToFtr({
  financialYear,
  href = '/app/deduction-bundle',
}: {
  financialYear: string;
  href?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose text-[14px]">
          Doing your tax return with Free Tax Returns? Download your {financialYear} deductions as a
          file and upload it there. It lists each deduction with its total and a fingerprint of each
          receipt. It has no merchant names, and it does not include the receipt images.
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => void send()} disabled={busy} className={buttonClasses('primary')}>
            Send {financialYear} to Free Tax Returns
          </button>
          {error ? <p role="alert" className="text-[13px] text-[var(--color-risk)]">{error}</p> : null}
        </div>
      </div>
    </Card>
  );
}
