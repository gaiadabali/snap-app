'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import './assistant.css';
import { mountAssistant, type AssistantHandle } from './index';

/**
 * Snapper, the Snap Apps assistant (docs/ASSISTANT.md §10).
 *
 * A thin island: the widget is framework-agnostic TypeScript that builds its own
 * DOM, so this renders nothing and mounts it once. Server HTML is untouched,
 * there is nothing to hydrate, and without JavaScript the widget is simply not
 * there. Cleaning up on unmount removes the launcher, the panel, every listener
 * and the mascot's GPU context, so React's Strict Mode double-run is harmless.
 *
 * The App Router keeps the marketing layout (and so this island) alive across
 * client-side navigation, which means an open conversation survives a click on
 * a link; the route is passed in so the welcome starters follow the page.
 */
export function Assistant() {
  const router = useRouter();
  const pathname = usePathname();
  const handle = useRef<AssistantHandle | null>(null);
  const firstPath = useRef(pathname);

  useEffect(() => {
    const h = mountAssistant({ navigate: (href) => router.push(href) });
    h.setPath(firstPath.current);
    handle.current = h;
    return () => {
      h.destroy();
      handle.current = null;
    };
  }, [router]);

  useEffect(() => {
    handle.current?.setPath(pathname);
  }, [pathname]);

  return null;
}
