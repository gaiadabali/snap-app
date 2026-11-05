import { config } from '@/lib/config';

/** Origins this site answers to: its configured public origin, and the one the browser actually used. */
function ownOrigins(req: Request): Set<string> {
  const set = new Set<string>();
  try {
    set.add(new URL(config.publicUrl).origin);
  } catch {
    /* an unparsable WEB_PUBLIC_URL is a config problem; the host check below still works */
  }
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0]?.trim();
  if (host) {
    const proto = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')).split(',')[0]?.trim();
    if (proto === 'http' || proto === 'https') set.add(`${proto}://${host}`);
  }
  return set;
}

/** True when the request is from another site. Browsers set both headers; scripts are limited by the API's rate limits. */
export function crossSite(req: Request): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  return !ownOrigins(req).has(origin);
}
