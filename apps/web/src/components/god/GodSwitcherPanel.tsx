import type { SwitcherTile } from '@/lib/god-brands';
import { GOD_BRANDS } from '@/lib/god-brands';

/**
 * The GOD app switcher's panel: one tile per GOD brand, and the GOD link in the footer
 * (god/god-holding/GOD-BAR-PLAN.md §2). Presentational: the open/closed state, focus and keys
 * live in `GodSwitcher`, so every state can be checked from props.
 *
 * - The current app is marked and not a link.
 * - Plain links with no query string: nothing about the person is sent to the destination.
 * - Tiles are at least 44 px tall and named by brand plus purpose.
 */
export const GOD_PANEL_ID = 'god-switcher-panel';

export function GodSwitcherPanel({ tiles }: { tiles: SwitcherTile[] }) {
  const tileClass =
    'flex min-h-[44px] items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left';
  return (
    <div
      id={GOD_PANEL_ID}
      role="dialog"
      aria-label={`${GOD_BRANDS.god.name} apps`}
      className="absolute inset-x-4 top-full z-30 mt-2 sm:inset-x-auto sm:right-0 sm:w-[22rem] rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] p-2 text-[var(--color-ink)] shadow-lg"
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
        {GOD_BRANDS.god.name} apps
      </p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {tiles.map((t) => {
          const inner = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark; the panel is rarely open */}
              <img src={t.icon} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[8px]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-tight">{t.name}</span>
                <span className="block text-[12px] leading-snug text-[var(--color-ink-muted)]">{t.purpose}</span>
              </span>
            </>
          );
          return (
            <li key={t.key}>
              {t.current ? (
                <div
                  aria-current="true"
                  className={`${tileClass} bg-[var(--color-accent-soft)]`}
                >
                  {inner}
                  <span className="shrink-0 rounded-full border border-[var(--color-rule-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink-muted)]">
                    You are here
                  </span>
                </div>
              ) : (
                <a
                  href={t.href ?? undefined}
                  className={`${tileClass} hover:bg-[var(--color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent-strong)]`}
                >
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 border-t border-[var(--color-rule)] pt-1">
        <a
          href={GOD_BRANDS.god.url}
          className="flex min-h-[44px] items-center justify-between gap-2 rounded-[var(--radius-md)] px-2.5 text-[13px] font-semibold text-[var(--color-accent-strong)] hover:bg-[var(--color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent-strong)]"
        >
          <span>{GOD_BRANDS.god.label}</span>
          <span className="text-[12px] font-normal text-[var(--color-ink-muted)]">About {GOD_BRANDS.god.name}</span>
        </a>
      </div>
    </div>
  );
}
