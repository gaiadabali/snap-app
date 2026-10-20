import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MascotLab } from './mascot-lab';

/**
 * Snapper's dev preview (docs/ASSISTANT.md §11–12). Development only: it 404s
 * in a production build, so it never ships as a page.
 *
 *   /mascot-lab                         every mood and gesture, sizes, themes
 *   /mascot-lab?poster=idle&size=320    one mascot, transparent, nothing else;
 *                                       sets body[data-ready="1"] after its
 *                                       first frame (scripts/render-snapper-poster.py)
 */
export const metadata: Metadata = {
  title: 'Mascot lab',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function MascotLabPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const sp = await searchParams;
  const posterParam = one(sp.poster);
  const poster = posterParam === 'idle' || posterParam === 'happy' ? posterParam : null;
  const sizeParam = Number(one(sp.size));
  const size = Number.isFinite(sizeParam) && sizeParam >= 32 && sizeParam <= 1024 ? Math.round(sizeParam) : 320;
  return <MascotLab poster={poster} size={size} />;
}
