import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Container, Empty } from '@/design/primitives';
import { getActiveWorkspaceId } from '@/lib/api/server';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import { panelRootFor, resolveImpersonatedWorkspace } from '@/lib/panels/impersonation';
import { requireSession } from '@/lib/panels/session';
import { resolveActiveWorkspace } from '@/lib/panels/workspace';
import { CreateWorkspaceForm } from '../_shell/CreateWorkspaceForm';
import { PanelShell } from '../_shell/PanelShell';
import { BUSINESS_NAV } from '../_shell/nav';

export default async function BusinessLayout({ children }: { children: ReactNode }) {
  // Business surfaces are switched off entirely (`src/lib/features.ts`) — a
  // 404 before any session or workspace lookup, so this route behaves
  // exactly like a route that does not exist, for anyone, business member or
  // not. Flip the flag back to `true` to restore everything below unchanged.
  if (!BUSINESS_SURFACES_ENABLED) notFound();

  const { user, workspaces, impersonation } = await requireSession();

  if (impersonation) {
    // See the same block in `(individual)/layout.tsx` — pinned by id, not by
    // kind, so this can never silently swap in a DIFFERENT business tenant
    // than the one the session was actually opened and audited for.
    const pinned = resolveImpersonatedWorkspace(workspaces, impersonation.tenantId);
    if (!pinned) redirect('/app/impersonation-ended');
    if (pinned.kind !== 'business') redirect(panelRootFor(pinned.kind));

    return (
      <PanelShell
        user={user}
        workspace={pinned}
        sameKindWorkspaces={[pinned]}
        otherKindHref={null}
        nav={BUSINESS_NAV}
        impersonation={impersonation}
      >
        {children}
      </PanelShell>
    );
  }

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
