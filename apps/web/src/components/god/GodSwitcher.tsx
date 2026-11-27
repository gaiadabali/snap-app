'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/design/site/icons';
import { GOD_BRANDS, switcherTiles } from '@/lib/god-brands';
import { GOD_PANEL_ID, GodSwitcherPanel } from './GodSwitcherPanel';

/**
 * The grid button in the app header and the GOD panel it opens.
 *
 * A real button with `aria-expanded`. Opening moves focus to the first link and keeps Tab inside the
 * panel; Escape closes it and hands focus back to the button; a click or tap outside closes it
 * without stealing focus; following a link closes it. No analytics: it adds nothing to what the
 * app already loads, and it sends nothing about the person to the destinations.
 *
 * `adultBrands` is the signal that already hides the Mail entry from a teen.
 */
export function GodSwitcher({ adultBrands }: { adultBrands: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>(`#${GOD_PANEL_ID} a[href]`)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(wrap.current?.querySelectorAll<HTMLElement>(`#${GOD_PANEL_ID} a[href]`) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === button.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Below sm the panel spans the header (the positioned ancestor); from sm it hangs under the button.
  return (
    <div ref={wrap} className="sm:relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={GOD_PANEL_ID}
        aria-haspopup="dialog"
        aria-label={`${GOD_BRANDS.god.name} apps`}
        onClick={() => setOpen((v) => !v)}
        className="grid size-11 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-strong)]"
      >
        <Icon name="grid" size={22} />
      </button>
      {open ? (
        // Following a link leaves the page or changes the route, so close with it.
        <div onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          <GodSwitcherPanel tiles={switcherTiles({ adultBrands })} />
        </div>
      ) : null}
    </div>
  );
}
