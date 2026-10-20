'use client';

import { useState, useTransition } from 'react';
import type { YourtalLinkStatus } from '@snap/api-contract';

import type { YourtalActionResult } from '@/lib/panels/yourtal-actions';
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
}: {
  /** What the server read for this render. */
  initial: LinkLoad;
  links: { getCode: string; wallet: string };
  retryHref: string;
  verifyEmailHref: string;
  onLink: (code: string) => Promise<YourtalActionResult>;
  onUnlink: () => Promise<YourtalActionResult>;
}) {
  const [load, setLoad] = useState<LinkLoad>(initial);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<LinkContext | null>(null);
  const [error, setError] = useState<{ context: LinkContext; code: string | null } | null>(null);
  const [, startTransition] = useTransition();

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
