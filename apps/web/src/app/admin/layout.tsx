import type { Metadata } from 'next';

import { CapabilityRefusal } from './_components/CapabilityRefusal';
import { ImpersonationBanner } from './_components/ImpersonationBanner';
import { PRIMARY_NAV } from './_components/nav';
import { Sidebar } from './_components/Sidebar';
import { Topbar } from './_components/Topbar';
import type { PaletteHit } from './_components/CommandPalette';
import { getAdminSession } from './_data/impersonation';
import { searchUsersForPalette } from './_data/people';
import { searchTenantsForPalette } from './_data/tenants';
import { getActiveImpersonationSession } from './_lib/impersonation-cookie';

export const metadata: Metadata = {
  title: { default: 'Overview', template: '%s · Snap Ops' },
  robots: { index: false, follow: false },
};

/**
 * The platform admin shell.
 *
 * The root gate lives HERE, not per-page: `GET /v1/admin/me` (`StaffGuard`)
 * is what every admin route already requires, so a 401/403 from it means
 * "not signed in" or "not platform staff at all" — nobody reaches so much as
 * the sidebar without it. This is still cosmetic, per docs/WEB.md §6: the
 * real boundary is that every capability-checked Postgres function in
 * `0021_admin_plane.sql` re-checks `staff_has_capability` itself regardless
 * of what this layout renders.
 *
 * Reading the active impersonation session HERE, at the layout level, is what
 * makes the banner impossible to lose: it is re-derived from the cookie on
 * every navigation, not client state a page could forget to render.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();

  if (!session.allowed) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--color-ground)] p-6">
        <div className="w-full max-w-[520px]">
          <CapabilityRefusal
            title="Not platform staff"
            status={session.status}
            message={
              session.status === 403
                ? 'This account is not registered as platform staff, so none of the admin plane is reachable.'
                : session.message
            }
          />
        </div>
      </div>
    );
  }

  const [people, tenants, activeSession] = await Promise.all([
    searchUsersForPalette(),
    searchTenantsForPalette(),
    getActiveImpersonationSession(),
  ]);

  const capabilities = session.data.capabilities;
  const reachableNav = PRIMARY_NAV.filter((n) => !n.capability || capabilities.includes(n.capability));

  const index: PaletteHit[] = [
    ...reachableNav.map((n) => ({ id: n.href, label: n.label, sublabel: n.hint, href: n.href, group: 'Section' as const })),
    ...people.map((p) => ({ ...p, group: 'Person' as const })),
    ...tenants.map((t) => ({ ...t, group: 'Tenant' as const })),
  ];

  return (
    <div className="flex min-h-dvh bg-[var(--color-ground)] text-[var(--color-ink)]">
      <Sidebar capabilities={capabilities} />
      <div className="flex min-w-0 flex-1 flex-col">
        {activeSession ? (
          <ImpersonationBanner
            subjectName={activeSession.subjectLabel}
            subjectEmail={activeSession.subjectEmail}
            tenantName={activeSession.tenantName}
            expiresAt={activeSession.expiresAt}
          />
        ) : null}
        <Topbar role={session.data.role} staffId={session.data.staffId} index={index} />
        <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
      </div>
    </div>
  );
}
