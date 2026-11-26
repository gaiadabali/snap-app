import { mailError, mailForward, readJsonObject } from '@/lib/panels/mail-bff';
import { APP_PASSWORD_NAME_MAX } from '@/lib/panels/mail-types';

/**
 * GET and POST /api/mail/app-passwords: list and create the passwords phone mail apps
 * use (`/v1/mail/app-passwords`, BUILD.md §4.10). The secret in the POST answer is shown
 * once and never readable again, so it is `no-store` like everything here.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return mailForward(req, { method: 'GET', path: '/v1/mail/app-passwords' });
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonObject(req);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name === '' || name.length > APP_PASSWORD_NAME_MAX || CONTROL.test(name)) {
    return mailError(400, 'bad_request', `Give it a name of 1 to ${APP_PASSWORD_NAME_MAX} characters.`);
  }
  return mailForward(req, {
    method: 'POST',
    path: '/v1/mail/app-passwords',
    body: { name },
    successStatus: 201,
    accept: (data) => typeof data === 'object' && data !== null && typeof (data as { secret?: unknown }).secret === 'string',
  });
}
