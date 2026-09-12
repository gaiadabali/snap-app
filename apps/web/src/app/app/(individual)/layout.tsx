import type { ReactNode } from 'react';

import { Container, Empty } from '@/design/primitives';
import { getActiveWorkspaceId } from '@/lib/api/server';
import { requireSession } from '@/lib/panels/session';
import { resolveActiveWorkspace } from '@/lib/panels/workspace';
import { CreateWorkspaceForm } from '../_shell/CreateWorkspaceForm';
import { PanelShell } from '../_shell/PanelShell';
import { INDIVIDUAL_NAV } from '../_shell/nav';

export default async function IndividualLayout({ children }: { children: ReactNode }) {
  const { user, workspaces } = await requireSession();
  const activeId = await getActiveWorkspaceId();
  const workspace = resolveActiveWorkspace(workspaces, 'personal', activeId);

  if (!workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center py-20">
        <Container width="prose">
          <Empty
            title="No personal workspace yet"
            body="A household is its own workspace, kept completely separate from any business you run — nobody sharing your business books can see it, and it never mentions GST or an ABN."
            action={<CreateWorkspaceForm kind="personal" path="/app" placeholder="e.g. The Marsh Household" />}
          />
        </Container>
      </main>
    );
  }

  const businessWorkspace = resolveActiveWorkspace(workspaces, 'business', activeId);

  return (
    <PanelShell
      user={user}
      workspace={workspace}
      sameKindWorkspaces={workspaces.filter((w) => w.kind === 'personal')}
      otherKindHref={businessWorkspace ? '/app/business' : null}
      nav={INDIVIDUAL_NAV}
    >
      {children}
    </PanelShell>
  );
}
