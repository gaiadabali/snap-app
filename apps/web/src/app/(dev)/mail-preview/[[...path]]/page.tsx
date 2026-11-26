import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MEMORY_ADDRESS } from '@snap/mail-engine/testing';

import { MailRoutes } from '../../../app/(individual)/mail/MailRoutes';
import { MailShell } from '../../../app/(individual)/mail/MailShell';
import { resolveMailRoute } from '@/lib/panels/mail-routes';
import { PreviewSwitchOn } from '../MailPreviewClient';

/**
 * The mail screens in a browser with no backend (spambank/BUILD.md T13). Development
 * only: it 404s in a production build, like the mascot lab.
 *
 *   /mail-preview                       Inbox, against the in-memory client
 *   /mail-preview/spam                  Spam, with the YourTal banner and counters
 *   /mail-preview/message/m2            the reader (m9 and m12 are spam and junk with HTML)
 *   /mail-preview/compose               compose; ?mode=reply&id=m1 for a reply
 *   /mail-preview/settings              address, statements, alerts, app passwords
 *   /mail-preview?state=off             the switch-on screen (?state=done shows the new address)
 *
 * It renders the real screens inside the real panel shell, so what you see is what
 * `/app/mail` draws. The `/api/mail/*` calls the settings screen makes (app passwords,
 * switches) are answered in the browser by a small in-memory stand-in
 * (`MailPreviewClient.tsx`), so nothing here touches a server.
 */
export const metadata: Metadata = { title: 'Mail preview', robots: { index: false, follow: false } };

type Params = Promise<{ path?: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MailPreviewPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const [{ path }, query] = await Promise.all([params, searchParams]);
  const route = resolveMailRoute(path, query);
  if (!route) notFound();
  const state = Array.isArray(query.state) ? query.state[0] : query.state;

  if (state === 'off' || state === 'done') return <PreviewSwitchOn start={state === 'done' ? 'done' : 'idle'} />;

  return (
    <MailShell
      account={{
        address: MEMORY_ADDRESS,
        quota: { limitBytes: 2_147_483_648, usedBytes: 38_400_000 },
        settings: { statements: false, workspaceId: null, alerts: true },
        statementWorkspaces: [{ id: 'ws-preview', name: 'Gee’s household' }],
      }}
    >
      <MailRoutes route={route} />
    </MailShell>
  );
}
