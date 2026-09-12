import type { Metadata } from 'next';

import { searchUsersForPalette } from './_data/people';
import { getCurrentStaff } from './_data/impersonation';
import { searchTenantsForPalette } from './_data/tenants';
import { getActiveImpersonationSession } from './_lib/impersonation-cookie';
import type { PaletteHit } from './_components/CommandPalette';
import { ImpersonationBanner } from './_components/ImpersonationBanner';
import { PRIMARY_NAV } from './_components/nav';
import { Sidebar } from './_components/Sidebar';
import { Topbar } from './_components/Topbar';

export const metadata: Metadata = {
  title: { default: 'Overview', template: '%s · Snap Ops' },
  robots: { index: false, follow: false },
};

/**
 * The platform admin shell.
 *
 * Everything under `/admin/*` renders through here — the sidebar, the top
 * bar, the global command palette, and (when a session is active) the
 * impersonation banner. Reading the active session HERE, at the layout
 * level, is what makes the banner impossible to lose: it is re-derived from
 * the cookie on every navigation, not client state a page could forget to
 * render.
 *
 * There is no route guard in this file. Platform-staff authorisation is a
 * server-enforced concern that does not exist yet — the admin backend
 * (a distinct staff identity table and role, docs/WEB.md §6 point 1) is being
 * built in parallel. UI gating is cosmetic; the real gate belongs server-side
 * and is out of this surface's scope.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [people, tenants, activeSession] = await Promise.all([
    searchUsersForPalette(),
    searchTenantsForPalette(),
    getActiveImpersonationSession(),
  ]);
  const staff = getCurrentStaff();

  const index: PaletteHit[] = [
    ...PRIMARY_NAV.map((n) => ({ id: n.href, label: n.label, sublabel: n.hint, href: n.href, group: 'Section' as const })),
    ...people.map((p) => ({ ...p, group: 'Person' as const })),
    ...tenants.map((t) => ({ ...t, group: 'Tenant' as const })),
  ];

  return (
    <div className="flex min-h-dvh bg-[var(--color-ground)] text-[var(--color-ink)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {activeSession ? (
          <ImpersonationBanner
            staffName={activeSession.staffName}
            subjectName={activeSession.subjectName}
            subjectEmail={activeSession.subjectEmail}
            tenantName={activeSession.tenantName}
            expiresAt={activeSession.expiresAt}
          />
        ) : null}
        <Topbar staffName={staff.name} index={index} />
        <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
      </div>
    </div>
  );
}
