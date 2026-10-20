import { config } from '@/lib/config';

/**
 * POST /api/assistant — the same-origin door to Snapper (docs/ASSISTANT.md §2).
 *
 * The browser never calls the API host. This handler checks that the request
 * really came from this site's own pages, forwards it with the shared secret
 * and the visitor's address (the API trusts that address only alongside a
 * valid secret), and streams the answer straight back, untouched.
 *
 * Node runtime and `force-dynamic`: the body is a live Server-Sent Events
 * stream, so nothing here may be buffered, cached or prerendered.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** docs/ASSISTANT.md §3: the request is JSON of at most 16 KB. */
const MAX_BODY = 16 * 1024;

/** The server's own total budget is 25 s; this is only a backstop for a hung upstream. */
const UPSTREAM_MAX_MS = 60_000;

const json = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

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
function crossSite(req: Request): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  return !ownOrigins(req).has(origin);
}

/** The visitor's address, from nginx's X-Real-IP (or the first X-Forwarded-For hop). Anything odd is dropped. */
function clientIp(req: Request): string | null {
  const raw = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ip = raw.trim();
  return ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/** Read the request body, giving up the moment it passes the cap (Content-Length can be absent or wrong). */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return json(403, 'bad_request');

  const body = await readCapped(req);
  if (!body) return json(413, 'bad_request');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  const secret = process.env.ASSISTANT_PROXY_SECRET;
  if (secret) headers['x-assistant-proxy'] = secret;
  const ip = clientIp(req);
  if (ip) headers['x-assistant-client-ip'] = ip;

  // The visitor closing the tab (or pressing Stop) aborts the upstream call.
  const ac = new AbortController();
  if (req.signal.aborted) return json(499, 'bad_request');
  const backstop = setTimeout(() => ac.abort(), UPSTREAM_MAX_MS);
  (backstop as unknown as { unref?: () => void }).unref?.();
  req.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(backstop);
      ac.abort();
    },
    { once: true },
  );

  let upstream: Response;
  try {
    upstream = await fetch(`${config.apiUrl}/v1/assistant/chat`, {
      method: 'POST',
      headers,
      body: body as BodyInit,
      signal: ac.signal,
      cache: 'no-store',
    });
  } catch {
    clearTimeout(backstop);
    return json(503, 'unavailable');
  }

  const out = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
