import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import type { WorkspaceSummary } from '@snap/api-contract';

import { PanelShell } from '../../app/_shell/PanelShell';
import { individualNavFor } from '../../app/_shell/nav';
import { MailPreviewRoot } from './MailPreviewClient';

/**
 * The preview's chrome lives in a layout, not the page, for the same reason the real
 * panel's does: the page remounts whenever its URL parameters change, and the in-memory
 * mail client (and so the fixtures you have moved around) must outlive that.
 */
const WORKSPACE: WorkspaceSummary = {
  id: 'ws-preview',
  name: 'Gee’s household',
  kind: 'personal',
  role: 'owner',
  memberCount: 1,
  abn: null,
  baseCurrency: 'AUD',
  teenSpace: null,
};

export default function MailPreviewLayout({ children }: { children: ReactNode }) {
  // Development only. Checked here as well as in the page: a layout renders around a
  // page's notFound(), and a production 404 must not wear a fake signed-in shell.
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <MailPreviewRoot>
      <PanelShell
        user={{ displayName: 'Gee Wizduck', initials: 'GW', email: 'gee@example.com' }}
        workspace={WORKSPACE}
        sameKindWorkspaces={[WORKSPACE]}
        otherKindHref={null}
        nav={individualNavFor(true, false, true)}
      >
        {children}
      </PanelShell>
    </MailPreviewRoot>
  );
}
