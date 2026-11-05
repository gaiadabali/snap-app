import { describe, expect, it, vi } from 'vitest';

import { ftrSendMessage, runFtrSend, type FtrSendDeps } from './ftr-send';

const URL_OUT = 'https://yourtal.test/auth?redirect_uri=au.com.snapapps.app%3A%2Foauth%2Fyourtal&transfer=t';
const BACK = 'au.com.snapapps.app:/oauth/yourtal';

function deps(over: Partial<FtrSendDeps> = {}) {
  const d = {
    start: vi.fn(async () => ({ url: URL_OUT, flowId: 'f1' })),
    openBrowser: vi.fn(async () => ({ type: 'success' as const, url: `${BACK}?code=c&state=s&iss=https%3A%2F%2Fy` })),
    finish: vi.fn(async () => ({ status: 'sent' as const, financialYear: '2025-26' })),
    ...over,
  };
  return d;
}
const go = (d: FtrSendDeps) => runFtrSend(d, { financialYear: '2025-26' });
const apiError = (code: string) => Object.assign(new Error('raw upstream text'), { code });

describe('runFtrSend', () => {
  it('starts, opens the browser on the app redirect, finishes with what came back, and reports sent', async () => {
    const d = deps();
    expect(await go(d)).toEqual({ kind: 'sent', year: '2025-26' });
    expect(d.start).toHaveBeenCalledWith({ financialYear: '2025-26' });
    expect(d.openBrowser).toHaveBeenCalledWith(URL_OUT, BACK);
    expect(d.finish).toHaveBeenCalledWith({ flowId: 'f1', state: 's', code: 'c', iss: 'https://y' });
  });

  it('Cancel at YourTal closes the send (error + state) and reports cancelled', async () => {
    const d = deps({
      openBrowser: vi.fn(async () => ({ type: 'success' as const, url: `${BACK}?error=access_denied&state=s` })),
      finish: vi.fn(async () => ({ status: 'cancelled' as const })),
    });
    expect(await go(d)).toEqual({ kind: 'cancelled' });
    expect(d.finish).toHaveBeenCalledWith({ flowId: 'f1', state: 's', error: 'access_denied' });
  });

  it('closing the browser is a quiet cancel and calls nothing more', async () => {
    const d = deps({ openBrowser: vi.fn(async () => ({ type: 'cancel' })) });
    expect(await go(d)).toEqual({ kind: 'cancelled' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('maps a start refusal to its fixed message, never the server text', async () => {
    const d = deps({ start: vi.fn(async () => { throw apiError('teen_space'); }) });
    const r = await go(d);
    expect(r).toEqual({ kind: 'failed', message: ftrSendMessage('teen_space') });
    expect(JSON.stringify(r)).not.toContain('raw upstream');
    expect(d.openBrowser).not.toHaveBeenCalled();
  });

  it('maps a finish refusal, an unknown code and a missing code', async () => {
    expect(await go(deps({ finish: vi.fn(async () => { throw apiError('ftr_unavailable'); }) }))).toEqual({
      kind: 'failed',
      message: "Free Tax Returns isn't answering right now. Try again in a few minutes. Nothing was sent.",
    });
    expect(await go(deps({ finish: vi.fn(async () => { throw apiError('brand_new'); }) }))).toEqual({
      kind: 'failed',
      message: 'Something went wrong. Nothing was sent.',
    });
    expect(await go(deps({ finish: vi.fn(async () => { throw new Error('offline'); }) }))).toMatchObject({ kind: 'failed' });
  });

  it('a return with no state or code is a failure and is not sent on', async () => {
    const d = deps({ openBrowser: vi.fn(async () => ({ type: 'success' as const, url: `${BACK}?code=c` })) });
    expect(await go(d)).toMatchObject({ kind: 'failed' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('a browser that throws is a failure', async () => {
    expect(await go(deps({ openBrowser: vi.fn(async () => { throw new Error('x'); }) }))).toMatchObject({ kind: 'failed' });
  });

  it('a dismissed browser (no return URL) is cancelled and nothing is finished', async () => {
    const d = deps({ openBrowser: vi.fn(async () => ({ type: 'dismiss' })) });
    expect(await go(d)).toEqual({ kind: 'cancelled' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('a returned URL with an error but no state stays failed', async () => {
    const d = deps({ openBrowser: vi.fn(async () => ({ type: 'success' as const, url: `${BACK}?error=access_denied` })) });
    expect(await go(d)).toMatchObject({ kind: 'failed' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('a send_refused from finish (Cancel at YourTal) is cancelled', async () => {
    const d = deps({
      openBrowser: vi.fn(async () => ({ type: 'success' as const, url: `${BACK}?error=send_refused&state=s` })),
      finish: vi.fn(async () => { throw apiError('send_refused'); }),
    });
    expect(await go(d)).toEqual({ kind: 'cancelled' });
  });
});
