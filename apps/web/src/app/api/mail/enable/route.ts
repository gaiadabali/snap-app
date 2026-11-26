import { mailForward } from '@/lib/panels/mail-bff';

/** POST /api/mail/enable: switch mail on (`POST /v1/mail/enable`). Answers the generated address. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return mailForward(req, {
    method: 'POST',
    path: '/v1/mail/enable',
    accept: (data) => typeof data === 'object' && data !== null && typeof (data as { address?: unknown }).address === 'string',
  });
}
