import { isMailSession, mailForward } from '@/lib/panels/mail-bff';

/**
 * POST /api/mail/session: mint a 30-minute mail token (`POST /v1/mail/session`).
 *
 * The mail engine calls this whenever it needs a token (first use, two minutes before
 * expiry, and once on a 401) and then talks to the YourTal mail proxy directly. The
 * answer carries the token, so it is `no-store`, and its URLs are checked to be https
 * before they are handed to the browser.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return mailForward(req, {
    method: 'POST',
    path: '/v1/mail/session',
    accept: (data) => isMailSession(data, process.env.NODE_ENV !== 'production'),
  });
}
