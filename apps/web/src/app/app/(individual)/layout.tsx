import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Container, Empty } from '@/design/primitives';
import { getActiveWorkspaceId } from '@/lib/api/server';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import { panelRootFor, resolveImpersonatedWorkspace } from '@/lib/panels/impersonation';
import { requireSession } from '@/lib/panels/session';
import { resolveActiveWorkspace } from '@/lib/panels/workspace';
import { CreateWorkspaceForm } from '../_shell/CreateWorkspaceForm';
import { ImpersonationBanner } from '../_shell/ImpersonationBanner';
import { PanelShell } from '../_shell/PanelShell';
import { INDIVIDUAL_NAV } from '../_shell/nav';

export default async function IndividualLayout({ children }: { children: ReactNode }) {
  const { user, workspaces, impersonation } = await requireSession();

  if (impersonation) {
    // Pinned to the EXACT tenant the session was opened for
    // (`getActiveWorkspaceId` already forces every `api()` call there) — this
    // finds that same workspace by id rather than falling back to "the
    // first personal workspace this person has", which would silently show
    // and act on a DIFFERENT tenant than the one that was opened and audited.
    const pinned = resolveImpersonatedWorkspace(workspaces, impersonation.tenantId);
    if (!pinned) redirect('/app/impersonation-ended');
    if (pinned.kind !== 'personal') {
      if (!BUSINESS_SURFACES_ENABLED) {
        // The tenant this impersonation session is pinned to is a business
        // workspace, and `/app/business` 404s while the flag is off.
        // Redirecting there would take the banner down with it — a
        // violation of docs/WEB.md §6.4 ("the UI can never hide it") for
        // the one audience (platform staff) who most needs to see it stay
        // up. Render the banner directly with an explanation instead of
        // bouncing into a dead end.
        return (
          <div className="min-h-screen bg-[var(--color-ground)]">
            <ImpersonationBanner {...impersonation} />
            <main className="flex min-h-[60vh] items-center justify-center py-20">
              <Container width="prose">
                <Empty
                  title="Business tools are turned off right now"
                  body={`${pinned.name} is a business workspace. Business tools are switched off while the personal side is redesigned, so there is nothing to show here — end impersonation above to return to the admin console.`}
                />
              </Container>
            </main>
          </div>
        );
      }
      redirect(panelRootFor(pinned.kind));
    }

    return (
      <PanelShell
        user={user}
        workspace={pinned}
        sameKindWorkspaces={[pinned]}
        otherKindHref={null}
        nav={INDIVIDUAL_NAV}
        impersonation={impersonation}
      >
        {children}
      </PanelShell>
    );
  }

  const activeId = await getActiveWorkspaceId();
  const workspace = resolveActiveWorkspace(workspaces, 'personal', activeId);

  if (!workspace) {
    // Business surfaces off (`src/lib/features.ts`) means this person's ONLY
    // workspace can be a business one they can no longer reach at all — the
    // case the flag is most likely to break, so it gets its own honest copy
    // rather than reusing the "brand-new account" empty state below, which
    // would wrongly imply they have never set anything up. Their business
    // data is untouched and comes back the moment the flag flips back on;
    // in the meantime the one thing they CAN do here is start a personal
    // workspace, so that is what is offered.
    const hasBusinessWorkspace = workspaces.some((w) => w.kind === 'business');
    const strandedByFlag = !BUSINESS_SURFACES_ENABLED && hasBusinessWorkspace;

    return (
      <main className="flex min-h-screen items-center justify-center py-20">
        <Container width="prose">
          <Empty
            title={strandedByFlag ? 'Business tools are turned off right now' : 'No personal workspace yet'}
            body={
              strandedByFlag
                ? 'The only workspace on this account is a business one, and business tools are switched off while the personal side is redesigned. Nothing in your business books has changed and it comes back as soon as they are switched back on. You can start a personal workspace below to track your own receipts in the meantime — it stays completely separate from the business.'
                : 'A household is its own workspace, kept completely separate from any business you run — nobody sharing your business books can see it, and it never mentions GST or an ABN.'
            }
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
      otherKindHref={BUSINESS_SURFACES_ENABLED && businessWorkspace ? '/app/business' : null}
      nav={INDIVIDUAL_NAV}
    >
      {children}
    </PanelShell>
  );
}
