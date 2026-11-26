import { mailError, mailForward, readJsonObject } from '@/lib/panels/mail-bff';

/**
 * PATCH /api/mail/settings: the statements switch with its workspace, and the
 * new-mail alerts switch (`PATCH /v1/mail/settings`). The API checks the workspace is
 * one the person owns or administers; this door only forwards the three known fields.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function PATCH(req: Request): Promise<Response> {
  const body = await readJsonObject(req);
  if (!body) return mailError(400, 'bad_request', 'That request was not understood.');

  const patch: { statements?: boolean; workspaceId?: string | null; alerts?: boolean } = {};
  if ('statements' in body) {
    if (typeof body.statements !== 'boolean') return mailError(400, 'bad_request', 'That request was not understood.');
    patch.statements = body.statements;
  }
  if ('alerts' in body) {
    if (typeof body.alerts !== 'boolean') return mailError(400, 'bad_request', 'That request was not understood.');
    patch.alerts = body.alerts;
  }
  if ('workspaceId' in body) {
    const id = body.workspaceId;
    if (id !== null && !(typeof id === 'string' && WORKSPACE_ID.test(id))) {
      return mailError(400, 'bad_request', 'That request was not understood.');
    }
    patch.workspaceId = id;
  }
  if (Object.keys(patch).length === 0) return mailError(400, 'bad_request', 'Nothing to change.');

  return mailForward(req, { method: 'PATCH', path: '/v1/mail/settings', body: patch });
}
