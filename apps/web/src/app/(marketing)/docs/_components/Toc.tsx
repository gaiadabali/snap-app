/**
 * In-page "On this page" table of contents.
 *
 * Static, not scroll-spied — the content here does not change per render, so
 * a hand-written list of section ids costs nothing and cannot drift silently
 * the way a DOM-scanning version can if a heading is edited without care.
 * Each `id` must match a heading's `id` in the same page.
 */
export function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="On this page" className="sticky top-8 hidden lg:block">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
        On this page
      </div>
      <ul className="mt-3 flex flex-col gap-2 border-l border-[var(--color-rule)] pl-4">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-[13px] leading-snug text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
