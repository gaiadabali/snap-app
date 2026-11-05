import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkspaceSummary } from '@snap/api-contract';

import { Container, cx } from '@/design/primitives';
import { signOut } from '@/lib/panels/actions';
import type { ImpersonationBannerInfo } from '@/lib/panels/impersonation';
import { ImpersonationBanner } from './ImpersonationBanner';
import type { NavItem } from './nav';
import { MobileNav } from './MobileNav';
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
  impersonation,
  children,
}: {
  user: { displayName: string; initials: string; email: string };
  workspace: WorkspaceSummary;
  /** Every workspace of the SAME kind this person belongs to — for the switcher. */
  sameKindWorkspaces: WorkspaceSummary[];
  /** Where the other panel lives, only if this person actually has one there. */
  otherKindHref: string | null;
  nav: NavItem[];
  /** Present only while platform staff is acting as this person — docs/WEB.md §6. */
  impersonation?: ImpersonationBannerInfo | null;
  children: ReactNode;
}) {
  const switchable = sameKindWorkspaces.length > 1;
  const switchLink =
    !impersonation && otherKindHref ? (
      <Link href={otherKindHref} className="text-[13px] font-semibold text-[var(--color-accent-strong)] hover:underline">
        {workspace.kind === 'business' ? 'Switch to personal' : 'Switch to business'}
      </Link>
    ) : null;

  return (
    <div className="min-h-screen bg-[var(--color-ground)]">
      {impersonation ? <ImpersonationBanner {...impersonation} /> : null}

      <header
        className={cx(
          'border-b border-[var(--color-rule)] bg-[var(--color-surface)]/95 backdrop-blur',
          // Only ONE bar in this shell stays pinned while impersonating —
          // the banner. Stacking two sticky elements needs their heights
          // kept in lockstep by hand; dropping stickiness here instead means
          // there is nothing to keep in sync, and the banner (the thing that
          // actually matters right now) is never displaced.
          impersonation ? 'relative' : 'sticky top-0 z-10',
        )}
      >
        <Container width="full" className="flex h-14 items-center gap-2 px-4 md:gap-4">
          <MobileNav items={nav}>
            {!impersonation && switchable ? (
              <div className="px-3 py-2 sm:hidden">
                <WorkspaceSwitcher workspaces={sameKindWorkspaces} activeId={workspace.id} className="w-full !max-w-none" />
              </div>
            ) : null}
            {switchLink ? <div className="px-3 py-2 sm:hidden">{switchLink}</div> : null}
          </MobileNav>
          <Link href="/" className="whitespace-nowrap text-[15px] font-bold text-[var(--color-ink)]">
            Snap Apps
          </Link>
          <span className="hidden rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] sm:inline">
            {workspace.kind === 'business' ? 'Business' : 'Personal'}
          </span>

          {impersonation ? (
            // Pinned to one tenant for the life of the session
            // (`MembershipGuard`) — offering a switcher that the server
            // would just 403 is worse than no switcher.
            <span className="truncate text-[13px] font-medium text-[var(--color-ink-muted)]">{workspace.name}</span>
          ) : switchable ? (
            <>
              {/* Below sm the picker lives in the menu: a select this wide does not fit the header. */}
              <span className="min-w-0 truncate text-[13px] font-medium text-[var(--color-ink-muted)] sm:hidden">
                {workspace.name}
              </span>
              <div className="hidden min-w-0 sm:block">
                <WorkspaceSwitcher workspaces={sameKindWorkspaces} activeId={workspace.id} />
              </div>
            </>
          ) : (
            <span className="truncate text-[13px] font-medium text-[var(--color-ink-muted)]">{workspace.name}</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            {switchLink ? <span className="hidden sm:inline">{switchLink}</span> : null}
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-strong)] text-[12px] font-bold text-[var(--color-accent-ink)]"
              title={`${user.displayName} · ${user.email}`}
            >
              {user.initials}
            </div>
            {impersonation ? null : (
              <form action={signOut}>
                <button
                  type="submit"
                  className="whitespace-nowrap text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </Container>
      </header>

      <Container width="full" className="flex gap-8 px-4 py-4 md:py-6">
        <aside className="hidden w-[220px] shrink-0 md:block">
          <Sidebar items={nav} />
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </Container>
    </div>
  );
}
