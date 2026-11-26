import { mailError, mailForward } from '@/lib/panels/mail-bff';

/** DELETE /api/mail/app-passwords/{id}: revoke one app password (`DELETE /v1/mail/app-passwords/:id`). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID.test(id)) return mailError(400, 'bad_request', 'That request was not understood.');
  return mailForward(req, { method: 'DELETE', path: `/v1/mail/app-passwords/${id}` });
}
