import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startFakeYourTalOidc, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';

/**
 * SnapApp's bridge to YourTal's Spambank machine API (spambank/BUILD.md §5.2,
 * ticket T11), against the stand-in YourTal: the real client-credentials flow
 * (`private_key_jwt`, scope `spambank`), the real call helper, and every answer
 * the bridge has to tell apart. No database is needed.
 */

let yt: FakeYourTalOidc;
let keyDir: string;
let mail: typeof import('./yourtal-mail.js');
let api: typeof import('../yourtal/oidc-client-api.js');

const SUB = 'bridge-sub-1';

beforeAll(async () => {
  yt = await startFakeYourTalOidc();
  keyDir = mkdtempSync(join(tmpdir(), 'snap-mail-bridge-'));
  const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
  writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });

  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('YOURTAL_OIDC_ISSUER', yt.issuer);
  vi.stubEnv('YOURTAL_OIDC_KEY_FILE', keyFile);
  vi.stubEnv('YOURTAL_OIDC_SERVER_CLIENT_ID', yt.serverClientId);
  vi.stubEnv('YOURTAL_API_URL', yt.issuer.replace(/\/oidc$/, ''));
  vi.resetModules();
  mail = await import('./yourtal-mail.js');
  api = await import('../yourtal/oidc-client-api.js');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  rmSync(keyDir, { recursive: true, force: true });
  await yt.close();
});

beforeEach(() => {
  api.resetOidcClientApiCache();
  yt.spambank.calls.length = 0;
  yt.spambank.bodies.length = 0;
  yt.spambank.down = null;
  yt.spambank.malformedSession = false;
  yt.spambank.people.clear();
  yt.spambank.attachments.clear();
});

describe('the Spambank machine API, as SnapApp calls it', () => {
  it('names the person by sub, on the spambank paths, and gets the status of a person with no mailbox', async () => {
    yt.spambank.addPerson(SUB);
    const result = await mail.yourtalMailStatus(SUB);

    expect(yt.spambank.calls).toEqual(['POST /status']);
    expect(yt.spambank.bodies).toEqual([{ sub: SUB }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mail.shapeStatus(result.body)).toEqual({
      mailbox: { state: 'off' },
      statements: false,
      alerts: true,
    });
  });

  it('enables a mailbox (201), then returns the same address (200)', async () => {
    yt.spambank.addPerson(SUB);
    const first = await mail.yourtalMailEnable(SUB);
    const second = await mail.yourtalMailEnable(SUB);

    expect(first.ok && first.status).toBe(201);
    expect(second.ok && second.status).toBe(200);
    if (!first.ok || !second.ok) throw new Error('enable failed');
    const a = mail.shapeEnable(first.body, first.status === 201);
    const b = mail.shapeEnable(second.body, second.status === 201);
    expect(a).toMatchObject({ state: 'on', created: true });
    expect(b).toMatchObject({ state: 'on', created: false });
    expect(b?.address).toBe(a?.address);

    const status = await mail.yourtalMailStatus(SUB);
    if (!status.ok) throw new Error('status failed');
    expect(mail.shapeStatus(status.body)?.mailbox).toMatchObject({
      state: 'on',
      address: a?.address,
      quota: { limitBytes: 2147483648, usedBytes: 1234 },
    });
  });

  it('mints a session and passes on only the five fields of the contract', async () => {
    yt.spambank.addPerson(SUB);
    await mail.yourtalMailEnable(SUB);
    const result = await mail.yourtalMailSession(SUB);
    if (!result.ok) throw new Error('session failed');

    expect(Object.keys(result.body)).toContain('internalNote');
    const shaped = mail.shapeSession(result.body);
    expect(shaped && Object.keys(shaped).sort()).toEqual(['address', 'expiresAt', 'helpersBase', 'sessionUrl', 'token']);
    expect(shaped?.token.startsWith('sbm1.')).toBe(true);
  });

  it('refuses a session body that is not the shape promised', async () => {
    yt.spambank.addPerson(SUB);
    await mail.yourtalMailEnable(SUB);
    yt.spambank.malformedSession = true;
    const result = await mail.yourtalMailSession(SUB);
    if (!result.ok) throw new Error('session failed');
    expect(mail.shapeSession(result.body)).toBeNull();
  });

  it('changes the two switches YourTal keeps', async () => {
    const person = yt.spambank.addPerson(SUB);
    const result = await mail.yourtalMailSettings(SUB, { statementsToSnapApp: true, newMailAlerts: false });
    expect(result.ok).toBe(true);
    expect(person).toMatchObject({ statementsToSnapApp: true, newMailAlerts: false });
    expect(yt.spambank.bodies[0]).toEqual({ sub: SUB, statementsToSnapApp: true, newMailAlerts: false });
  });

  it('lists, creates and revokes app passwords; the secret exists only in the create answer', async () => {
    yt.spambank.addPerson(SUB);
    await mail.yourtalMailEnable(SUB);

    const created = await mail.yourtalAppPasswordCreate(SUB, 'Pixel mail');
    if (!created.ok) throw new Error('create failed');
    expect(created.status).toBe(201);
    const shaped = mail.shapeAppPasswordCreated(created.body);
    expect(shaped).toMatchObject({
      name: 'Pixel mail',
      imap: { port: 993, security: 'ssl' },
      smtp: { port: 465, security: 'ssl' },
    });
    expect(shaped?.secret.startsWith('app_')).toBe(true);

    const listed = await mail.yourtalAppPasswordList(SUB);
    if (!listed.ok) throw new Error('list failed');
    const items = mail.shapeAppPasswordList(listed.body);
    expect(items?.items.map((i) => i.name)).toEqual(['Pixel mail']);
    expect(JSON.stringify(items)).not.toContain('app_');

    const revoked = await mail.yourtalAppPasswordRevoke(SUB, shaped!.id);
    expect(revoked).toMatchObject({ ok: true, status: 204 });
    const gone = await mail.yourtalAppPasswordRevoke(SUB, shaped!.id);
    expect(gone).toMatchObject({ ok: false, reason: 'rejected', status: 404 });
  });

  it('tells the failures apart: unknown sub, not allowed, no mailbox yet, rate limited-style refusals', async () => {
    expect(await mail.yourtalMailStatus('nobody')).toMatchObject({ ok: false, reason: 'unknown_subject', status: 404 });

    yt.spambank.addPerson('teen-sub', { refusal: 'not_allowed' });
    expect(await mail.yourtalMailStatus('teen-sub')).toMatchObject({ ok: false, reason: 'not_allowed', status: 403 });
    expect(await mail.yourtalMailEnable('teen-sub')).toMatchObject({ ok: false, reason: 'not_allowed' });

    yt.spambank.addPerson(SUB);
    expect(await mail.yourtalMailSession(SUB)).toMatchObject({ ok: false, reason: 'not_enabled', status: 409 });
    expect(await mail.yourtalAppPasswordList(SUB)).toMatchObject({ ok: false, reason: 'not_enabled' });
  });

  it('reports YourTal down as unavailable, and its mail server down as spambank_unavailable', async () => {
    yt.spambank.addPerson(SUB);
    yt.spambank.down = 'yourtal';
    expect(await mail.yourtalMailStatus(SUB)).toMatchObject({ ok: false, reason: 'unavailable', status: 503 });
    yt.spambank.down = 'spambank';
    expect(await mail.yourtalMailStatus(SUB)).toMatchObject({ ok: false, reason: 'spambank_unavailable', status: 503 });
  });

  it('reports unreachable YourTal as unavailable, without throwing', async () => {
    vi.stubEnv('YOURTAL_API_URL', 'http://127.0.0.1:1');
    vi.resetModules();
    const offline = await import('./yourtal-mail.js');
    expect(await offline.yourtalMailStatus(SUB)).toEqual({ ok: false, reason: 'unavailable', status: null, code: null });
    vi.stubEnv('YOURTAL_API_URL', yt.issuer.replace(/\/oidc$/, ''));
    vi.resetModules();
  });
});

describe('oidcApiBytes: a file from YourTal', () => {
  const FILE = Buffer.from('date,amount\n2026-11-01,12.50\n', 'utf8');

  beforeEach(() => {
    yt.spambank.addPerson(SUB);
    yt.spambank.attachments.set('Mabc/Gxyz', { bytes: FILE, type: 'text/csv' });
  });

  it('returns the bytes and the content type unchanged', async () => {
    const answer = await api.oidcApiBytes('spambank', 'POST', '/api/oidc-clients/spambank/attachments/fetch', {
      sub: SUB,
      emailId: 'Mabc',
      blobId: 'Gxyz',
    });
    expect(answer?.status).toBe(200);
    expect(answer?.contentType).toBe('text/csv');
    expect(createHash('sha256').update(answer!.bytes).digest('hex')).toBe(createHash('sha256').update(FILE).digest('hex'));
  });

  it('hands an error answer back as bytes with its status, for the caller to read', async () => {
    const answer = await api.oidcApiBytes('spambank', 'POST', '/api/oidc-clients/spambank/attachments/fetch', {
      sub: SUB,
      emailId: 'Mabc',
      blobId: 'nope',
    });
    expect(answer?.status).toBe(404);
    expect(JSON.parse(answer!.bytes.toString('utf8'))).toEqual({ code: 'not_found' });
  });

  it('refuses an answer larger than the limit, and reads no further than it', async () => {
    const answer = await api.oidcApiBytes(
      'spambank',
      'POST',
      '/api/oidc-clients/spambank/attachments/fetch',
      { sub: SUB, emailId: 'Mabc', blobId: 'Gxyz' },
      { maxBytes: 10 },
    );
    expect(answer).toBeNull();
  });

  it('is null, not a throw, when YourTal cannot be reached', async () => {
    vi.stubEnv('YOURTAL_API_URL', 'http://127.0.0.1:1');
    vi.resetModules();
    const offline = await import('../yourtal/oidc-client-api.js');
    expect(await offline.oidcApiBytes('spambank', 'POST', '/x', {})).toBeNull();
    vi.stubEnv('YOURTAL_API_URL', yt.issuer.replace(/\/oidc$/, ''));
    vi.resetModules();
  });
});

describe('mailAvailable', () => {
  async function availability(enabled: string | undefined, withClient = true): Promise<boolean> {
    vi.stubEnv('SPAMBANK_ENABLED', enabled ?? '');
    if (!withClient) vi.stubEnv('YOURTAL_OIDC_SERVER_CLIENT_ID', '');
    vi.resetModules();
    const { mailAvailable } = await import('./enabled.js');
    const result = mailAvailable();
    vi.stubEnv('YOURTAL_OIDC_SERVER_CLIENT_ID', yt.serverClientId);
    return result;
  }

  it('is on when SPAMBANK_ENABLED is unset or blank (the owner\'s default), and the YourTal client is configured', async () => {
    expect(await availability(undefined)).toBe(true);
    expect(await availability('1')).toBe(true);
    expect(await availability('true')).toBe(true);
  });

  it.each(['0', 'false', 'off', 'no', ' 0 ', 'FALSE'])('is off for SPAMBANK_ENABLED=%j', async (value) => {
    expect(await availability(value)).toBe(false);
  });

  it('is off without SnapApp\'s YourTal server client, whatever the switch says', async () => {
    expect(await availability(undefined, false)).toBe(false);
  });
});
