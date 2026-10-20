'use client';

import { useEffect, useRef, useState } from 'react';

export type Chapter = { id: string; label: string };

/**
 * The in-page chapter nav. Plain anchors, so it works with no JavaScript; the
 * island only adds "you are here". An IntersectionObserver watches a thin band
 * across the upper-middle of the viewport and the chapter inside it is the
 * current one. A single ink pill slides between the tabs.
 *
 * Reduced motion: the pill still moves, but without the glide (see features.css)
 * and the strip jumps instead of easing when it scrolls the active tab into view.
 */
export function ChapterNav({ chapters }: { chapters: readonly Chapter[] }) {
  const [active, setActive] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const inBand = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        setActive(chapters.find((c) => inBand.has(c.id))?.id ?? null);
      },
      { rootMargin: '-35% 0px -55% 0px' },
    );
    for (const c of chapters) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [chapters]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const place = (scroll: boolean) => {
      const a = active ? links.current.get(active) : undefined;
      if (!a) {
        track.removeAttribute('data-ready');
        return;
      }
      track.style.setProperty('--x', String(a.offsetLeft));
      track.style.setProperty('--w', String(a.offsetWidth));
      track.setAttribute('data-ready', '');
      const nav = navRef.current;
      if (scroll && nav && nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({
          left: Math.max(0, a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2),
          behavior: reduced ? 'auto' : 'smooth',
        });
      }
    };

    place(true);
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  return (
    <nav ref={navRef} aria-label="Chapters on this page" className="feat-nav">
      <div ref={trackRef} className="feat-nav-track">
        <span className="feat-nav-ind" aria-hidden />
        <ul>
          {chapters.map((c) => (
            <li key={c.id}>
              <a
                href={`#${c.id}`}
                aria-current={active === c.id ? 'true' : undefined}
                ref={(el) => {
                  if (el) links.current.set(c.id, el);
                  else links.current.delete(c.id);
                }}
              >
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
