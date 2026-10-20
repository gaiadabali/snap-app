/**
 * The site Snapper lives on (docs/ASSISTANT.md §9): the only paths it may
 * link to, their titles, and the hosts that count as "this site" when the
 * model writes an absolute URL.
 *
 * A path missing here cannot be linked, whatever the knowledge pack or the
 * model says — add it here when the page ships.
 */

export const SITE_URL = 'https://snap-apps.gaiada.com';

export const SITE_PAGES: Readonly<Record<string, string>> = Object.freeze({
  '/': 'Snap Apps',
  '/features': 'Features',
  '/how-it-works': 'How it works',
  '/pricing': 'Pricing',
  '/download': 'Download',
  '/support': 'Support',
  '/docs': 'Docs',
  '/docs/getting-started': 'Getting started',
  '/docs/capturing-receipts': 'Capturing receipts',
  '/docs/reviewing-corrections': 'Reviewing corrections',
  '/docs/confidence-and-flags': 'Confidence and flags',
  '/docs/ledger-and-posted': 'Ledger and posted',
  '/docs/data-retention': 'Data retention',
  '/legal/privacy': 'Privacy',
  '/legal/terms': 'Terms',
  '/legal/security': 'Security',
  '/register': 'Start free',
  '/sign-in': 'Sign in',
});

export const ALLOWED_PATHS: ReadonlySet<string> = new Set(Object.keys(SITE_PAGES));

/** Absolute URLs on these hosts are this site (scheme and www optional). */
export const SITE_HOSTS = /^(?:https?:\/\/)?(?:www\.)?(?:snap-apps\.gaiada\.com|snapapps\.com\.au)(?=[/?#]|$)/i;

/** Where each call to action points. */
export const CTA_PATHS = Object.freeze({ app: '/download', start: '/register', human: '/support' });

/**
 * A site path normalised for the allow-list: host stripped, query dropped,
 * trailing slash dropped (except the root), anchor kept apart.
 * Returns null when it is not a path on this site.
 */
export function sitePath(href: string): { path: string; hash: string } | null {
  let h = href.trim().replace(SITE_HOSTS, '');
  if (h === '') h = '/';
  if (!h.startsWith('/') || h.startsWith('//')) return null;
  const hashAt = h.indexOf('#');
  const hash = hashAt >= 0 ? h.slice(hashAt) : '';
  let p = (hashAt >= 0 ? h.slice(0, hashAt) : h).split('?')[0] ?? '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '') p = '/';
  if (hash && !/^#[A-Za-z0-9_-]{1,80}$/.test(hash)) return { path: p, hash: '' };
  return { path: p, hash };
}

/** The href to keep for a link to this site, or null when the path is not allowed. */
export function allowedSiteHref(href: string): string | null {
  const s = sitePath(href);
  if (!s || !ALLOWED_PATHS.has(s.path)) return null;
  return `${s.path}${s.hash}`;
}
