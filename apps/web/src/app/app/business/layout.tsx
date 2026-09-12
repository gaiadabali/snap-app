import type { ReactNode } from 'react';

import { Container, Empty } from '@/design/primitives';
import { getActiveWorkspaceId } from '@/lib/api/server';
import { requireSession } from '@/lib/panels/session';
import { resolveActiveWorkspace } from '@/lib/panels/workspace';
import { CreateWorkspaceForm } from '../_shell/CreateWorkspaceForm';
import { PanelShell } from '../_shell/PanelShell';
import { BUSINESS_NAV } from '../_shell/nav';

export default async function BusinessLayout({ children }: { children: ReactNode }) {
  const { user, workspaces } = await requireSession();
  const activeId = await getActiveWorkspaceId();
  const workspace = resolveActiveWorkspace(workspaces, 'business', activeId);

  if (!workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center py-20">
        <Container width="prose">
          <Empty
            title="No business workspace yet"
            body="A business is its own workspace with its own ABN, GST setting and ledger — separate from any personal spending you track, and the one place invoices, bills and BAS figures live."
            action={<CreateWorkspaceForm kind="business" path="/app/business" placeholder="e.g. K. Marsh Transport" />}
          />
        </Container>
      </main>
    );
  }

  const personalWorkspace = resolveActiveWorkspace(workspaces, 'personal', activeId);

  return (
    <PanelShell
      user={user}
      workspace={workspace}
      sameKindWorkspaces={workspaces.filter((w) => w.kind === 'business')}
      otherKindHref={personalWorkspace ? '/app' : null}
      nav={BUSINESS_NAV}
    >
      {children}
    </PanelShell>
  );
}
