import { mailForward } from '@/lib/panels/mail-bff';

/**
 * GET /api/mail/status: the person's mailbox state, from `GET /v1/mail/status`.
 * The same-origin door of spambank/BUILD.md §5.6; see `lib/panels/mail-bff.ts`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return mailForward(req, { method: 'GET', path: '/v1/mail/status' });
}
