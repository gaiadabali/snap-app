'use client';

/**
 * Global Cmd/Ctrl-K jump — the single feature that makes an operator console
 * feel fast. Fed a bounded, pre-fetched index (people, tenants, static
 * sections) from the server layout; see the note in `_data/people.ts` and
 * `_data/tenants.ts` about moving to a server-search endpoint once the
 * index outgrows a few hundred rows.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

export type PaletteHit = { id: string; label: string; sublabel: string; href: string; group: 'Section' | 'Person' | 'Tenant' };

export function CommandPalette({ index }: { index: PaletteHit[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? index.filter((hit) => hit.label.toLowerCase().includes(q) || hit.sublabel.toLowerCase().includes(q))
      : index.filter((hit) => hit.group === 'Section');
    return pool.slice(0, 20);
  }, [index, query]);

  function go(hit: PaletteHit) {
    setOpen(false);
    router.push(hit.href);
  }

  function onKeyDownList(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[cursor];
      if (hit) go(hit);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-64 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-3 text-[13px] text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-accent)]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[14px] w-[14px] shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.4-3.4" />
        </svg>
        <span className="flex-1 text-left">Jump to a user, tenant, or section…</span>
        <kbd className="rounded border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-1 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-rule-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-rule)] px-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[16px] w-[16px] shrink-0 text-[var(--color-ink-faint)]">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.4-3.4" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onKeyDownList}
                placeholder="Search people, tenants, sections…"
                className="h-12 flex-1 bg-transparent text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
              />
              <kbd className="rounded border border-[var(--color-rule-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
                Esc
              </kbd>
            </div>
            <ul className="max-h-[360px] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-[13px] text-[var(--color-ink-faint)]">
                  Nothing matches “{query}”.
                </li>
              ) : (
                results.map((hit, i) => (
                  <li key={`${hit.group}-${hit.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(hit)}
                      className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left ${
                        i === cursor ? 'bg-[var(--color-accent-soft)]' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold text-[var(--color-ink)]">
                          {hit.label}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--color-ink-muted)]">
                          {hit.sublabel}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-alt)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                        {hit.group}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
