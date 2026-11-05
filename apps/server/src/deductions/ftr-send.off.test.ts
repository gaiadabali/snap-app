import { describe, expect, it } from 'vitest';

/**
 * With FTR_TRANSFER_URL unset direct send is off (4.8.a, docs/30 §1 "Switches"): start answers 501
 * not_configured and the year endpoint offers no button. Refused before any database access, so no database here.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
delete process.env.FTR_TRANSFER_URL;

const user = { userId: '11111111-1111-4111-8111-111111111111', email: 'x@x.test', displayName: 'x', initials: 'X' } as never;
const tenant = '22222222-2222-4222-8222-222222222222';

describe('direct send is off without FTR_TRANSFER_URL', () => {
  it('start is 501 not_configured and /year says directSend: false', async () => {
    const { FtrSendController } = await import('./ftr-send.controller.js');
    const { DeductionBundleController } = await import('./deduction-bundle.controller.js');
    const refused = await new FtrSendController()
      .start(user, tenant, undefined, { client: 'web', locale: 'en-AU' } as never)
      .then(() => null, (e: { getStatus(): number; getResponse(): unknown }) => ({ status: e.getStatus(), body: e.getResponse() }));
    expect(refused).toMatchObject({ status: 501, body: { error: 'not_configured' } });
    const year = await new DeductionBundleController().year(user, tenant, undefined, { header: () => undefined });
    expect(year.directSend).toBe(false);
  });
});
