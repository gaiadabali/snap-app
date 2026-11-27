import { mailForward } from '@/lib/panels/mail-bff';

/**
 * GET /api/mail/imports: statements imported from the person's Spambank mailbox,
 * from `GET /v1/mail/imports` (Spambank T12). Nothing from the request is passed on.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return mailForward(req, { method: 'GET', path: '/v1/mail/imports' });
}
