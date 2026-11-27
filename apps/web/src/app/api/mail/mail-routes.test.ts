import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route handlers whitelist what they forward. `mailForward` is replaced by a spy so
// the test sees exactly which request the handler decided to make (or refused to).
const forward = vi.hoisted(() => vi.fn());

vi.mock('@/lib/panels/mail-bff', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/panels/mail-bff')>();
  return { ...real, mailForward: forward };
});

import { DELETE } from './app-passwords/[id]/route';
import { POST as createPassword } from './app-passwords/route';
import { POST as enable } from './enable/route';
import { GET as imports } from './imports/route';
import { POST as session } from './session/route';
import { PATCH as patchSettings } from './settings/route';

const req = (method: string, body?: unknown) =>
  new Request('http://localhost:3000/api/mail/x', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });

beforeEach(() => {
  forward.mockReset();
  forward.mockResolvedValue(new Response('{}'));
});

describe('PATCH /api/mail/settings', () => {
  it('forwards only the three known fields', async () => {
    await patchSettings(req('PATCH', { statements: true, workspaceId: 'ws1', alerts: false, evil: 'x', userId: 'someone' }));
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]?.[1]).toEqual({
      method: 'PATCH',
      path: '/v1/mail/settings',
      body: { statements: true, workspaceId: 'ws1', alerts: false },
    });
  });

  it('allows clearing the workspace with null', async () => {
    await patchSettings(req('PATCH', { workspaceId: null }));
    expect(forward.mock.calls[0]?.[1]).toMatchObject({ body: { workspaceId: null } });
  });

  it.each([
    [{ statements: 'yes' }],
    [{ alerts: 1 }],
    [{ workspaceId: '../../etc' }],
    [{ workspaceId: 42 }],
    [{}],
    [{ unknown: true }],
  ])('refuses %j without calling the API', async (body) => {
    const res = await patchSettings(req('PATCH', body));
    expect(res.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const res = await patchSettings(new Request('http://localhost:3000/api/mail/settings', { method: 'PATCH', body: '{nope' }));
    expect(res.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('POST /api/mail/app-passwords', () => {
  it('forwards a trimmed name and nothing else, answering 201', async () => {
    await createPassword(req('POST', { name: '  Pixel mail  ', sub: 'someone-else', scope: 'admin' }));
    expect(forward.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      path: '/v1/mail/app-passwords',
      body: { name: 'Pixel mail' },
      successStatus: 201,
    });
  });

  it.each([[''], ['   '], ['x'.repeat(41)], ['line\nbreak'], ['nul\u0000']])('refuses the name %j', async (name) => {
    const res = await createPassword(req('POST', { name }));
    expect(res.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses a missing or non-string name', async () => {
    expect((await createPassword(req('POST', {}))).status).toBe(400);
    expect((await createPassword(req('POST', { name: 7 }))).status).toBe(400);
  });

  it('accepts a 40 character name', async () => {
    await createPassword(req('POST', { name: 'x'.repeat(40) }));
    expect(forward).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/mail/app-passwords/{id}', () => {
  it('forwards a plain id', async () => {
    await DELETE(req('DELETE'), { params: Promise.resolve({ id: 'ap_12-x' }) });
    expect(forward.mock.calls[0]?.[1]).toEqual({ method: 'DELETE', path: '/v1/mail/app-passwords/ap_12-x' });
  });

  it.each([['../status'], ['a/b'], ['a?b=1'], [''], ['x'.repeat(200)]])('refuses the id %j (no path tricks)', async (id) => {
    const res = await DELETE(req('DELETE'), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('POST /api/mail/session and /enable', () => {
  it('only accept an upstream answer of the expected shape', async () => {
    await session(req('POST'));
    const sessionSpec = forward.mock.calls[0]?.[1] as { accept: (d: unknown) => boolean; path: string };
    expect(sessionSpec.path).toBe('/v1/mail/session');
    expect(sessionSpec.accept({ nope: 1 })).toBe(false);

    await enable(req('POST'));
    const enableSpec = forward.mock.calls[1]?.[1] as { accept: (d: unknown) => boolean };
    expect(enableSpec.accept({ address: 'a@b.co' })).toBe(true);
    expect(enableSpec.accept({})).toBe(false);
  });
});

describe('GET /api/mail/imports', () => {
  it('forwards to the import list and nothing else', async () => {
    await imports(new Request('http://localhost:3000/api/mail/imports?userId=someone-else'));
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]?.[1]).toEqual({ method: 'GET', path: '/v1/mail/imports' });
  });
});
