import { config } from '@/lib/config';

/**
 * GET /api/assistant/status — proxies `/v1/assistant/status`.
 *
 * The widget stays hidden until this says `ok`, so ANY failure here (the API
 * down, the secret missing or wrong, a timeout, an unreadable answer) is
 * reported as `{ ok: false }` with a 200. The widget treats that as "not
 * available" and a visitor never sees a chat that cannot reply.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } as const;

const down = (): Response => new Response(JSON.stringify({ ok: false }), { status: 200, headers: HEADERS });

export async function GET(): Promise<Response> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    const secret = process.env.ASSISTANT_PROXY_SECRET;
    if (secret) headers['x-assistant-proxy'] = secret;
    const res = await fetch(`${config.apiUrl}/v1/assistant/status`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return down();
    const j = (await res.json()) as { ok?: unknown; name?: unknown };
    if (j.ok !== true) return down();
    return new Response(JSON.stringify({ ok: true, name: typeof j.name === 'string' ? j.name : 'Snapper' }), {
      status: 200,
      headers: HEADERS,
    });
  } catch {
    return down();
  }
}
