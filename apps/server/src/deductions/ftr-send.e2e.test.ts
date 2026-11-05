import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotAMemberError } from '@snap/db';
import { Client } from 'pg';

import { closeDb } from '../db.js';
import { startFakeFtr, type FakeFtr } from '../test-support/fake-ftr.js';
import { startFakeYourTalOidc, type FakePerson, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';
import { wipeTenant } from '../test-support/tenant.js';

/**
 * Send to Free Tax Returns (4.8.a S2), end to end: a real Postgres as the
 * application role, a real `oidc-provider` standing in for YourTal (its
 * authorization screen, ID tokens and transfer API), and a recording stand-in
 * for FTR. The controller is called directly with the session's user and
 * workspace, as the deduction bundle e2e does.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type Fixture = { userId: string; tenantId: string; person: FakePerson; sub: string };

describeIfDb('POST /v1/ftr-sends and /finish', () => {
  let yt: FakeYourTalOidc;
  let ftr: FakeFtr;
  let admin: Client;
  let keyDir: string;
  let send: InstanceType<typeof import('./ftr-send.controller.js').FtrSendController>;
  let signIn: InstanceType<typeof import('../auth/yourtal-signin/yourtal-signin.controller.js').YourTalSignInController>;
  let bundleController: InstanceType<typeof import('./deduction-bundle.controller.js').DeductionBundleController>;
  const tenants: string[] = [];
  const users: string[] = [];

  const asUser = (id: string) => ({ userId: id, email: `${id}@x.test`, displayName: 'x', initials: 'X' }) as never;

  /** A person with a personal workspace, a YourTal `sub` and one reviewed deduction. */
  async function fixture(o: { kind?: 'personal' | 'business'; country?: string; role?: string; subject?: (sub: string) => string; teen?: boolean } = {}): Promise<Fixture> {
    const userId = randomUUID();
    const tenantId = randomUUID();
    const person: FakePerson = {
      accountId: randomUUID(),
      email: `ftr-send-${userId.slice(0, 8)}@example.test`,
      name: 'Sender',
      region: 'AU',
      ageBand: 'adult',
    };
    const sub = yt.subFor(person.accountId);
    tenants.push(tenantId);
    users.push(userId);
    await admin.query(`insert into users (id, subject, email, display_name) values ($1,$2,$3,'Sender')`, [
      userId,
      (o.subject ?? ((s) => `yourtal|${s}`))(sub),
      person.email,
    ]);
    await admin.query(
      `insert into tenants (id, name, kind, country, occupation_profile_id) values ($1,'Mine',$2,$3,'teacher')`,
      [tenantId, o.kind ?? 'personal', o.country ?? 'AU'],
    );
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,$3)`, [tenantId, userId, o.role ?? 'owner']);
    if (o.role && o.role !== 'owner') {
      // A workspace needs an owner of its own for the member to be a member of.
      const ownerId = randomUUID();
      users.push(ownerId);
      await admin.query(`insert into users (id, subject, email, display_name) values ($1,$2,$3,'Owner')`, [ownerId, `test|${ownerId}`, `${ownerId}@x.test`]);
      await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,'owner')`, [tenantId, ownerId]);
    }
    if (o.teen) {
      await admin.query(`insert into teen_spaces (tenant_id, teen_user_id, invite_id) values ($1,$2,$3)`, [tenantId, userId, randomUUID()]);
    }
    const cat = randomUUID();
    await admin.query(
      `insert into categories (id, tenant_id, name, ato_deduction_code, engine_row_id, private_use_percent, active)
       values ($1,$2,'Tools','D5','tools',null,true)`,
      [cat, tenantId],
    );
    const capture = randomUUID();
    const original = `orig-${capture}`;
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
       values ($1,$2,$3,$4,'image/png',1, decode($5,'hex'),'received')`,
      [capture, tenantId, userId, `${tenantId}/o/${capture}`, sha(original)],
    );
    await admin.query(
      `insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
       values ($1,$2,$3,1,$4,'image/png',1,decode($5,'hex'),'capture')`,
      [randomUUID(), tenantId, capture, `${tenantId}/pages/${randomUUID()}`, sha(original)],
    );
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, issue_date, payable_amount, category_id, category_source, review_status, currency, doc_type)
       values ($1,$2,$3,'2025-09-01','12.34',$4,'user','reviewed','AUD','receipt')`,
      [randomUUID(), tenantId, capture, cat],
    );
    return { userId, tenantId, person, sub };
  }

  const row = async (sendId: string) =>
    (await admin.query(`select status, error, ftr_import_id, bundle, bundle_sha256::text as sha, yourtal_transfer_id, line_count from ftr_sends where id = $1`, [sendId])).rows[0];

  const begin = (f: Fixture, client: 'web' | 'mobile' = 'web') =>
    send.start(asUser(f.userId), f.tenantId, undefined, { client, locale: 'en-AU' } as never);

  /** The person confirms (or cancels) at the stand-in YourTal; what the callback hands to finish. */
  async function confirm(started: { url: string; flowId: string }, who: FakePerson | { cancel: string }) {
    yt.nextSignIn = 'cancel' in who ? who : { person: who };
    const redirect = await yt.authorize(started.url);
    return {
      flowId: started.flowId,
      state: redirect.searchParams.get('state')!,
      code: redirect.searchParams.get('code') ?? undefined,
      iss: redirect.searchParams.get('iss') ?? undefined,
      error: redirect.searchParams.get('error') ?? undefined,
    };
  }

  const finish = (f: Fixture, body: Awaited<ReturnType<typeof confirm>>, tenantId = f.tenantId) =>
    send.finish(asUser(f.userId), tenantId, undefined, body as never);

  const refusalOf = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { getStatus?: () => number; getResponse?: () => unknown }) => ({ status: e.getStatus?.(), body: e.getResponse?.() as Record<string, unknown> }),
    );

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    ftr = await startFakeFtr();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-ftr-send-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_WEB_CLIENT_ID = yt.webClientId;
    process.env.YOURTAL_OIDC_MOBILE_CLIENT_ID = yt.mobileClientId;
    process.env.YOURTAL_OIDC_WEB_REDIRECT_URI = yt.webRedirectUri;
    process.env.YOURTAL_OIDC_KEY_FILE = keyFile;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    process.env.YOURTAL_API_URL = new URL(yt.issuer).origin;
    process.env.FTR_TRANSFER_URL = ftr.url;

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    send = new (await import('./ftr-send.controller.js')).FtrSendController();
    signIn = new (await import('../auth/yourtal-signin/yourtal-signin.controller.js')).YourTalSignInController();
    bundleController = new (await import('./deduction-bundle.controller.js')).DeductionBundleController();
  });

  afterAll(async () => {
    if (admin) {
      await admin.query('delete from teen_spaces where tenant_id = any($1)', [tenants]);
      for (const t of tenants) await wipeTenant(admin, t);
      await admin.query('delete from users where id = any($1)', [users]);
      await admin.end();
    }
    await closeDb();
    await yt?.close();
    await ftr?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('start opens a transfer for the session’s own sub and returns a URL carrying it; the bundle waits in the row', async () => {
    const f = await fixture();
    const started = await begin(f);
    const transfer = [...yt.transfers.values()].find((t) => t.fromSub === f.sub)!;
    expect(transfer).toBeTruthy();
    expect(new URL(started.url).searchParams.get('transfer')).toBe(transfer.transferId);
    expect(transfer.financialYear).toBe('2025-26');
    const r = await row(started.sendId);
    expect(r).toMatchObject({ status: 'started', yourtal_transfer_id: transfer.transferId, sha: transfer.bundleSha256, line_count: transfer.lineCount });
    expect(sha(r.bundle)).toBe(transfer.bundleSha256);
    // The year endpoint now offers the button for this person.
    const reply = { header: () => undefined };
    expect(await bundleController.year(asUser(f.userId), f.tenantId, undefined, reply)).toMatchObject({ directSend: true });
  });

  it('finish posts the stored bytes with the assertion; the row is sent and the bytes are gone', async () => {
    const f = await fixture();
    const started = await begin(f);
    const stored = (await row(started.sendId)).bundle as string;
    ftr.calls.length = 0;
    const logged: string[] = [];
    const spies = [process.stdout, process.stderr].map((s) =>
      vi.spyOn(s, 'write').mockImplementation(((chunk: unknown) => (logged.push(String(chunk)), true)) as never),
    );
    let done;
    try {
      done = await finish(f, await confirm(started, f.person));
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(done).toMatchObject({ status: 'sent', importId: 'imp-1', financialYear: '2025-26' });
    const transfer = yt.transfers.get((await row(started.sendId)).yourtal_transfer_id)!;
    expect(ftr.calls).toHaveLength(1);
    expect(ftr.calls[0]!.body.toString('utf8')).toBe(stored);
    expect(sha(ftr.calls[0]!.body.toString('utf8'))).toBe(transfer.bundleSha256);
    expect(ftr.calls[0]!.authorization).toBe(`Bearer ${transfer.assertion}`);
    expect(ftr.calls[0]!.contentType).toBe('application/json');
    expect(await row(started.sendId)).toMatchObject({ status: 'sent', bundle: null, ftr_import_id: 'imp-1', error: null });
    // Nothing from YourTal reaches a log line.
    expect(logged.join('')).toContain('ftr send ok');
    expect(logged.join('')).not.toContain(transfer.assertion!);
  });

  it('another sub in the ID token: wrong_account, nothing sent, the send is closed', async () => {
    const f = await fixture();
    const other: FakePerson = { accountId: randomUUID(), email: `other-${f.userId.slice(0, 8)}@example.test`, region: 'AU', ageBand: 'adult' };
    const started = await begin(f);
    ftr.calls.length = 0;
    const refused = await refusalOf(finish(f, await confirm(started, other)));
    expect(refused).toMatchObject({ status: 403, body: { error: 'wrong_account' } });
    expect(ftr.calls).toHaveLength(0);
    expect(await row(started.sendId)).toMatchObject({ status: 'failed', error: 'wrong_account', bundle: null });
  });

  it('an ID token that says a teen, or a person in Indonesia, is refused by SnapApp itself: 403 not_allowed, nothing sent, the send failed', async () => {
    for (const change of [{ ageBand: 'teen' }, { region: 'ID' }] as const) {
      const f = await fixture();
      const started = await begin(f);
      ftr.calls.length = 0;
      // Same account (same sub), but YourTal's token now says teen / ID: the fake does not refuse them, so only SnapApp's re-check can.
      const body = await confirm(started, { ...f.person, ...change });
      expect(await refusalOf(finish(f, body))).toMatchObject({ status: 403, body: { error: 'not_allowed' } });
      expect(ftr.calls).toHaveLength(0);
      expect(await row(started.sendId)).toMatchObject({ status: 'failed', error: 'not_allowed', bundle: null });
    }
  });

  it('staff impersonating a person cannot finish a send either, and the flow is not burnt', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    const refused = await refusalOf(send.finish(asUser(f.userId), f.tenantId, { sessionId: 's' } as never, body as never));
    expect(refused).toMatchObject({ status: 403, body: { error: 'impersonated' } });
    expect(await row(started.sendId)).toMatchObject({ status: 'started' });
    expect(await finish(f, body)).toMatchObject({ status: 'sent' });
  });

  it('Cancel at YourTal closes the send as cancelled; nothing is sent', async () => {
    const f = await fixture();
    const started = await begin(f);
    ftr.calls.length = 0;
    const done = await finish(f, await confirm(started, { cancel: 'user_cancelled' }));
    expect(done).toEqual({ status: 'cancelled', returnTo: null });
    expect(ftr.calls).toHaveLength(0);
    expect(await row(started.sendId)).toMatchObject({ status: 'cancelled', bundle: null, error: 'access_denied' });
  });

  it('not approved (or no longer allowed) at YourTal sends nothing and closes the send', async () => {
    for (const code of ['not_approved', 'not_allowed'] as const) {
      const f = await fixture();
      const started = await begin(f);
      const body = await confirm(started, f.person);
      yt.assertionRefusal = code;
      ftr.calls.length = 0;
      try {
        expect(await refusalOf(finish(f, body))).toMatchObject({ status: code === 'not_approved' ? 409 : 403, body: { error: code } });
      } finally {
        yt.assertionRefusal = null;
      }
      expect(ftr.calls).toHaveLength(0);
      expect(await row(started.sendId)).toMatchObject({ status: 'failed', error: code, bundle: null });
    }
  });

  it('an FTR refusal sends nothing more and closes the send with FTR’s code; busy FTR is tried once more with the same assertion', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    ftr.calls.length = 0;
    ftr.answers = [{ status: 422, body: { err: 'unsupported_year' } }];
    expect(await refusalOf(finish(f, body))).toMatchObject({ status: 422, body: { error: 'ftr_refused', reason: 'unsupported_year' } });
    expect(ftr.calls).toHaveLength(1);
    expect(await row(started.sendId)).toMatchObject({ status: 'failed', error: 'ftr_refused:unsupported_year', bundle: null });

    const g = await fixture();
    const second = await begin(g);
    const body2 = await confirm(second, g.person);
    ftr.calls.length = 0;
    ftr.answers = [{ status: 503, body: { err: 'unavailable' } }];
    expect(await refusalOf(finish(g, body2))).toMatchObject({ status: 503, body: { error: 'ftr_unavailable' } });
    expect(ftr.calls).toHaveLength(2);
    expect(ftr.calls[1]!.authorization).toBe(ftr.calls[0]!.authorization);
    expect(await row(second.sendId)).toMatchObject({ status: 'failed', error: 'ftr_unavailable', bundle: null });

    // A first 503 then success: sent, after the retry.
    const h = await fixture();
    const third = await begin(h);
    const body3 = await confirm(third, h.person);
    ftr.calls.length = 0;
    ftr.answers = [{ status: 503, body: {} }, { status: 200, body: { importId: 'imp-9' } }];
    expect(await finish(h, body3)).toMatchObject({ status: 'sent', importId: 'imp-9' });
    expect(ftr.calls).toHaveLength(2);
    ftr.answers = [{ status: 201, body: { importId: 'imp-1' } }];
  });

  it('a redirect from FTR is not followed: the target, a server that records requests, is never called', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    const elsewhere = await startFakeFtr();
    ftr.calls.length = 0;
    ftr.redirectTo = elsewhere.url;
    // 303, not 307: a following client then re-sends a plain GET (undici cannot replay the 307's body), so only redirect:'error' stops it.
    ftr.redirectStatus = 303;
    try {
      expect(await refusalOf(finish(f, body))).toMatchObject({ body: { error: 'ftr_unavailable' } });
    } finally {
      ftr.redirectTo = null;
      ftr.redirectStatus = 307;
      await elsewhere.close();
    }
    expect(ftr.calls).toHaveLength(2); // the original try and its one retry
    expect(elsewhere.calls).toHaveLength(0); // never the redirect target, which would have got the assertion
  });

  it('a business workspace, an admin, a plain member, a teen space, a workspace outside Australia and a legacy subject get 403 and no transfer', async () => {
    const cases: Array<[string, Fixture, string]> = [
      ['not_personal', await fixture({ kind: 'business' }), 'not_personal'],
      ['region_not_supported', await fixture({ country: 'ID' }), 'region_not_supported'],
      ['not_owner', await fixture({ role: 'admin' }), 'not_owner'],
      ['not_owner', await fixture({ role: 'member' }), 'not_owner'],
      ['teen_space', await fixture({ teen: true }), 'teen_space'],
      ['yourtal_sign_in_required', await fixture({ subject: (s) => `google|${s}` }), 'yourtal_sign_in_required'],
    ];
    for (const [, f, code] of cases) {
      const before = yt.transfers.size;
      expect(await refusalOf(begin(f))).toMatchObject({ status: 403, body: { error: code } });
      expect(yt.transfers.size).toBe(before);
      expect((await admin.query('select 1 from ftr_sends where user_id = $1', [f.userId])).rows).toHaveLength(0);
      expect(await bundleController.year(asUser(f.userId), f.tenantId, undefined, { header: () => undefined })).toMatchObject({ directSend: false });
    }
  });

  it('staff impersonating a person cannot send', async () => {
    const f = await fixture();
    const refused = await refusalOf(send.start(asUser(f.userId), f.tenantId, { sessionId: 's' } as never, { client: 'web', locale: 'en-AU' } as never));
    expect(refused).toMatchObject({ status: 403, body: { error: 'impersonated' } });
  });

  it('five sends per person per 15 minutes', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i += 1) await begin(f);
    expect(await refusalOf(begin(f))).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('a person with nothing to send gets nothing_to_send and no send row', async () => {
    const f = await fixture();
    await admin.query('delete from documents where tenant_id = $1', [f.tenantId]);
    expect(await refusalOf(begin(f))).toMatchObject({ status: 422, body: { error: 'nothing_to_send' } });
    expect((await admin.query('select 1 from ftr_sends where user_id = $1', [f.userId])).rows).toHaveLength(0);
  });

  it('YourTal down at start: 503, and the send is closed (no bytes left open)', async () => {
    const f = await fixture();
    yt.transferApiDown = true;
    try {
      expect(await refusalOf(begin(f))).toMatchObject({ status: 503, body: { error: 'yourtal_unavailable' } });
    } finally {
      yt.transferApiDown = false;
    }
    expect((await admin.query(`select status, error, bundle from ftr_sends where user_id = $1`, [f.userId])).rows).toEqual([
      { status: 'failed', error: 'yourtal_unavailable', bundle: null },
    ]);
  });

  it('neither finish takes the other’s flow: the sign-in finish refuses a send flow and leaves it usable', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    const refused = await refusalOf(signIn.finish({ flowId: body.flowId, code: body.code!, state: body.state, iss: body.iss! }, { ip: '10.9.9.9' }));
    expect(refused).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    expect(await row(started.sendId)).toMatchObject({ status: 'started' });
    expect(await finish(f, body)).toMatchObject({ status: 'sent' });
  });

  it('a flow linked to another workspace’s send is refused, and that send is left alone', async () => {
    const a = await fixture();
    const b = await fixture();
    const aStart = await begin(a);
    const bStart = await begin(b);
    // app_identity may link a flow to ANY send (a foreign key ignores RLS): B's flow now points at A's send.
    await admin.query(`update yourtal_sign_in_flows set ftr_send_id = $1 where id = $2`, [aStart.sendId, bStart.flowId]);
    const body = await confirm(bStart, b.person);
    expect(await refusalOf(finish(b, body))).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    expect(await row(aStart.sendId)).toMatchObject({ status: 'started' });
    // Nor does naming the other workspace help: B is no member of it.
    const again = await confirm(await begin(b), b.person);
    await admin.query(`update yourtal_sign_in_flows set ftr_send_id = $1 where id = $2`, [aStart.sendId, again.flowId]);
    // B is no member of A's workspace: the database refuses entry, whatever the header says.
    await expect(finish(b, again, a.tenantId)).rejects.toBeInstanceOf(NotAMemberError);

    expect(await row(aStart.sendId)).toMatchObject({ status: 'started' });
  });

  it('a send of another person in the same workspace is refused (user_id is checked)', async () => {
    const a = await fixture();
    const aStart = await begin(a);
    // A second member of A's workspace finishes with A's flow.
    const intruder = randomUUID();
    users.push(intruder);
    await admin.query(`insert into users (id, subject, email, display_name) values ($1,$2,$3,'I')`, [intruder, `yourtal|${yt.subFor(randomUUID())}`, `${intruder}@x.test`]);
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,'member')`, [a.tenantId, intruder]);
    const body = await confirm(aStart, a.person);
    const refused = await refusalOf(send.finish(asUser(intruder), a.tenantId, undefined, body as never));
    expect(refused).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    expect(await row(aStart.sendId)).toMatchObject({ status: 'started' });
  });

  it('a send over 59 minutes old (the sweep expires at 60) is refused and closed as expired, whether or not the sweep has run', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    await admin.query(`update ftr_sends set created_at = now() - interval '59 minutes 30 seconds' where id = $1`, [started.sendId]);
    ftr.calls.length = 0;
    expect(await refusalOf(finish(f, body))).toMatchObject({ status: 400, body: { error: 'send_expired' } });
    expect(ftr.calls).toHaveLength(0);
    expect(await row(started.sendId)).toMatchObject({ status: 'expired', bundle: null, error: 'send_expired' });
  });

  it('a second finish with the same flow is refused; a closed send is never reopened', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    expect(await finish(f, body)).toMatchObject({ status: 'sent' });
    ftr.calls.length = 0;
    expect(await refusalOf(finish(f, body))).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    expect(ftr.calls).toHaveLength(0);
    expect(await row(started.sendId)).toMatchObject({ status: 'sent', ftr_import_id: 'imp-1' });
  });

  it('a wrong state burns the flow and closes the send', async () => {
    const f = await fixture();
    const started = await begin(f);
    const body = await confirm(started, f.person);
    expect(await refusalOf(finish(f, { ...body, state: 'not-the-state' }))).toMatchObject({ status: 400, body: { error: 'invalid_flow' } });
    expect(await row(started.sendId)).toMatchObject({ status: 'failed', bundle: null });
    expect(await refusalOf(finish(f, body))).toMatchObject({ body: { error: 'invalid_flow' } });
  });
});
