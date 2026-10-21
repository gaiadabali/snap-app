import { describe, expect, it, vi } from 'vitest';

import {
  deniedMessage,
  isUseYourtal,
  isYourtalReturn,
  parseReturnUrl,
  runYourtalSignIn,
  SIGNIN_COPY,
  SIGNIN_ERROR_CODES,
  signInErrorMessage,
  YOURTAL_REDIRECT_URI,
  type SignInDeps,
} from './yourtal-signin';

const REDIRECT = 'au.com.snapapps.app:/oauth/yourtal';

describe('parseReturnUrl', () => {
  it('reads code, state and iss', () => {
    expect(parseReturnUrl(`${REDIRECT}?code=abc&state=st1&iss=https%3A%2F%2Fid.yourtal.test`)).toEqual({
      kind: 'code',
      code: 'abc',
      state: 'st1',
      iss: 'https://id.yourtal.test',
    });
  });

  it('decodes percent-escapes and plus signs, and ignores a fragment and extra parameters', () => {
    const r = parseReturnUrl(`${REDIRECT}?x=1&code=a%2Fb%3D&state=s+t&iss=i#frag`);
    expect(r).toEqual({ kind: 'code', code: 'a/b=', state: 's t', iss: 'i' });
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseReturnUrl(`${REDIRECT}?code=one&code=two&state=s&iss=i`)).toMatchObject({ code: 'one' });
  });

  it('reads access_denied with its description', () => {
    expect(parseReturnUrl(`${REDIRECT}?error=access_denied&error_description=account_on_hold&state=s`)).toEqual({
      kind: 'denied',
      error: 'access_denied',
      description: 'account_on_hold',
    });
    expect(parseReturnUrl(`${REDIRECT}?error=access_denied`)).toEqual({
      kind: 'denied',
      error: 'access_denied',
      description: null,
    });
  });

  it('an error wins over a code', () => {
    expect(parseReturnUrl(`${REDIRECT}?code=c&state=s&iss=i&error=server_error`)).toMatchObject({
      kind: 'denied',
      error: 'server_error',
    });
  });

  it.each([
    ['no query', REDIRECT],
    ['no code', `${REDIRECT}?state=s&iss=i`],
    ['no state', `${REDIRECT}?code=c&iss=i`],
    ['no iss', `${REDIRECT}?code=c&state=s`],
    ['an empty code', `${REDIRECT}?code=&state=s&iss=i`],
    ['a bad escape', `${REDIRECT}?code=%E0%A4%A&state=s&iss=i`],
    ['nothing', ''],
  ])('%s is invalid', (_name, url) => {
    expect(parseReturnUrl(url)).toEqual({ kind: 'invalid' });
  });
});

describe('isYourtalReturn', () => {
  it.each([
    REDIRECT,
    `${REDIRECT}?code=c&state=s`,
    'au.com.snapapps.app://oauth/yourtal?code=c',
    '/oauth/yourtal?code=c',
    'oauth/yourtal',
  ])('%s is the redirect', (p) => expect(isYourtalReturn(p)).toBe(true));

  it.each(['/', '/join/abc', 'snapapps://join/abc', '/oauth/yourtalx', '/x/oauth/yourtal'])('%s is not', (p) =>
    expect(isYourtalReturn(p)).toBe(false),
  );
});

describe('refusal messages', () => {
  it('has a message for every code, all different, none empty', () => {
    const all = SIGNIN_ERROR_CODES.map((c) => signInErrorMessage(c));
    expect(all.every((m) => m.length > 10)).toBe(true);
    expect(new Set(all).size).toBe(SIGNIN_ERROR_CODES.length);
  });

  it.each([
    ['invalid_flow', 'Start again'],
    ['yourtal_failed', 'could not sign you in'],
    ['region_not_supported', 'Australia and Indonesia'],
    ['teen_invite_required', 'invitation'],
    ['email_unverified', 'Confirm your email'],
    ['staff_strong_auth_required', 'security key'],
    ['account_review', 'flagged'],
    ['try_again', 'try again'],
    ['rate_limited', 'Too many tries'],
    ['not_configured', 'available'],
    ['yourtal_unavailable', 'answering'],
    ['use_yourtal', 'This account now signs in with YourTal'],
  ])('%s says something useful', (code, fragment) => {
    expect(signInErrorMessage(code).toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('an unknown or missing code, even one named like a prototype key, gets the generic sentence', () => {
    for (const c of ['nope', 'constructor', '__proto__', '', null, undefined]) {
      expect(signInErrorMessage(c)).toBe('Could not sign you in with YourTal. Try again.');
    }
  });

  it('use_yourtal is recognised, and its heading is the one the spec asks for', () => {
    expect(isUseYourtal('use_yourtal')).toBe(true);
    expect(isUseYourtal('invalid_flow')).toBe(false);
    expect(SIGNIN_COPY.useYourtalTitle).toBe('This account now signs in with YourTal');
  });

  it("maps YourTal's own denials, and treats a plain refusal as the person saying no", () => {
    expect(deniedMessage('access_denied', 'account_on_hold')).toContain('on hold');
    expect(deniedMessage('access_denied', 'region_not_supported')).toContain('Australia and Indonesia');
    expect(deniedMessage('access_denied', 'teen_invite_required')).toContain('invitation');
    expect(deniedMessage('access_denied', 'teen_not_allowed')).toContain('invitation');
    expect(deniedMessage('access_denied', 'user_cancelled')).toBeNull();
    expect(deniedMessage('access_denied', null)).toBeNull();
    expect(deniedMessage('access_denied', 'constructor')).toBeNull();
    expect(deniedMessage('server_error', null)).toContain('Could not sign you in');
  });
});

type Session = { user: string };
type Fn = ReturnType<typeof vi.fn>;

function deps(over: Record<string, Fn> = {}) {
  return {
    start: vi.fn(async () => ({ url: 'https://id.yourtal.test/authorize?state=SECRET', flowId: 'flow-1' })),
    openBrowser: vi.fn(async () => ({
      type: 'success',
      url: `${REDIRECT}?code=CODE&state=st&iss=https%3A%2F%2Fid.yourtal.test`,
    })),
    finish: vi.fn(async () => ({ user: 'kira' })),
    ...over,
  } as unknown as SignInDeps<Session> & { start: Fn; openBrowser: Fn; finish: Fn };
}

const returning = (url: string) => vi.fn(async () => ({ type: 'success', url }));

describe('runYourtalSignIn', () => {
  it('start, then the system browser at the private-use redirect, then finish with the flow id', async () => {
    const d = deps();
    const result = await runYourtalSignIn(d);

    expect(result).toEqual({ kind: 'signed-in', session: { user: 'kira' } });
    expect(d.start).toHaveBeenCalledWith({ signUp: false, locale: undefined });
    expect(d.openBrowser).toHaveBeenCalledWith('https://id.yourtal.test/authorize?state=SECRET', YOURTAL_REDIRECT_URI);
    expect(YOURTAL_REDIRECT_URI).toBe('au.com.snapapps.app:/oauth/yourtal');
    expect(d.finish).toHaveBeenCalledWith({
      flowId: 'flow-1',
      code: 'CODE',
      state: 'st',
      iss: 'https://id.yourtal.test',
    });
    const order = [d.start, d.openBrowser, d.finish].map((f) => f.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('asks for sign-up when told to', async () => {
    const d = deps();
    await runYourtalSignIn(d, { signUp: true, locale: 'id-ID' });
    expect(d.start).toHaveBeenCalledWith({ signUp: true, locale: 'id-ID' });
  });

  it.each(['cancel', 'dismiss', 'locked'])('a browser that ends with "%s" returns quietly, with no finish', async (type) => {
    const d = deps({ openBrowser: vi.fn(async () => ({ type })) });
    expect(await runYourtalSignIn(d)).toEqual({ kind: 'quiet' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('a user_cancelled or plain access_denied return is quiet', async () => {
    for (const q of ['error=access_denied&error_description=user_cancelled', 'error=access_denied']) {
      const d = deps({ openBrowser: returning(`${REDIRECT}?${q}`) });
      expect(await runYourtalSignIn(d)).toEqual({ kind: 'quiet' });
      expect(d.finish).not.toHaveBeenCalled();
    }
  });

  it('an account on hold is a message, with no finish', async () => {
    const d = deps({ openBrowser: returning(`${REDIRECT}?error=access_denied&error_description=account_on_hold`) });
    const r = await runYourtalSignIn(d);
    expect(r).toMatchObject({ kind: 'failed', code: 'yourtal_failed' });
    expect((r as { message: string }).message).toContain('on hold');
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('a return missing a piece fails with the generic YourTal message and never calls finish', async () => {
    const d = deps({ openBrowser: returning(`${REDIRECT}?code=c&state=s`) });
    expect(await runYourtalSignIn(d)).toEqual({
      kind: 'failed',
      code: 'yourtal_failed',
      message: signInErrorMessage('yourtal_failed'),
    });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it.each(SIGNIN_ERROR_CODES)('a %s refusal from start or finish becomes its message', async (code) => {
    const refusal = Object.assign(new Error('server words'), { code });
    const atStart = await runYourtalSignIn(deps({ start: vi.fn(async () => Promise.reject(refusal)) }));
    expect(atStart).toEqual({ kind: 'failed', code, message: signInErrorMessage(code) });

    const d = deps({ finish: vi.fn(async () => Promise.reject(refusal)) });
    expect(await runYourtalSignIn(d)).toEqual({ kind: 'failed', code, message: signInErrorMessage(code) });
    expect(d.finish).toHaveBeenCalledTimes(1);
  });

  it('a network failure (no code) gets the generic sentence; a browser crash is yourtal_failed', async () => {
    const net = await runYourtalSignIn(deps({ finish: vi.fn(async () => Promise.reject(new Error('offline'))) }));
    expect(net).toMatchObject({ kind: 'failed', code: null });
    const crash = await runYourtalSignIn(deps({ openBrowser: vi.fn(async () => Promise.reject(new Error('x'))) }));
    expect(crash).toMatchObject({ kind: 'failed', code: 'yourtal_failed' });
  });

  it('puts no secret in any result and logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const d = deps({ finish: vi.fn(async () => Promise.reject(new Error('boom CODE st SECRET'))) });
    const r = await runYourtalSignIn(d);
    expect(JSON.stringify(r)).not.toMatch(/CODE|SECRET|state=/);
    spies.forEach((s) => {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    });
  });
});
