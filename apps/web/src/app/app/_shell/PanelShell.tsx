import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkspaceSummary } from '@snap/api-contract';

import { Container } from '@/design/primitives';
import { signOut } from '@/lib/panels/actions';
import type { NavItem } from './nav';
import { Sidebar } from './Sidebar';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * The chrome around every `/app` and `/app/business` page.
 *
 * One shell, parameterised by which nav list and which workspace kind is
 * active — the individual and business panels are the same shell wearing a
 * different sidebar, not two separate layouts that could drift apart.
 */
export function PanelShell({
  user,
  workspace,
  sameKindWorkspaces,
  otherKindHref,
  nav,
  children,
}: {
  user: { displayName: string; initials: string; email: string };
  workspace: WorkspaceSummary;
  /** Every workspace of the SAME kind this person belongs to — for the switcher. */
  sameKindWorkspaces: WorkspaceSummary[];
  /** Where the other panel lives, only if this person actually has one there. */
  otherKindHref: string | null;
  nav: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-ground)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-rule)] bg-[var(--color-surface)]/95 backdrop-blur">
        <Container width="full" className="flex h-14 items-center gap-4 px-4">
          <Link href="/" className="text-[15px] font-bold text-[var(--color-ink)]">
            Snap Apps
          </Link>
          <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
            {workspace.kind === 'business' ? 'Business' : 'Personal'}
          </span>

          {sameKindWorkspaces.length > 1 ? (
            <WorkspaceSwitcher
              workspaces={sameKindWorkspaces}
              activeId={workspace.id}
            />
          ) : (
            <span className="truncate text-[13px] font-medium text-[var(--color-ink-muted)]">
              {workspace.name}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            {otherKindHref ? (
              <Link
                href={otherKindHref}
                className="text-[13px] font-semibold text-[var(--color-accent)] hover:underline"
              >
                {workspace.kind === 'business' ? 'Switch to personal' : 'Switch to business'}
              </Link>
            ) : null}
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[12px] font-bold text-[var(--color-accent-ink)]"
              title={`${user.displayName} · ${user.email}`}
            >
              {user.initials}
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </Container>
      </header>

      <Container width="full" className="flex gap-8 px-4 py-6">
        <aside className="w-[220px] shrink-0">
          <Sidebar items={nav} />
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </Container>
    </div>
  );
}
