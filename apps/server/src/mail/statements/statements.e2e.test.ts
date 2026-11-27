import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import type { JWTPayload } from 'jose';
import type { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFakeYourTalOidc, type FakeYourTalOidc } from '../../test-support/fake-yourtal-oidc.js';
import { provisionTenant, wipeTenant } from '../../test-support/tenant.js';
import { workerDatabaseUrl } from '../../test-support/worker-db.js';
import { ENCRYPTED_STATEMENT_PDF_B64 } from './fixtures/encrypted-statement.js';
import { statementPdf } from './fixtures/statement-pdf.js';

/**
 * Statements mailed to a Spambank address, imported into SnapApp, end to end
 * (Spambank T12; spambank/BUILD.md §4.8, F5): a `spambank-statement` Security
 * Event Token signed by the stand-in YourTal, posted to `/v1/yourtal/events`
 * through the real AppModule, then run by the worker's job loop on the
 * worker's own connection (snap_worker), fetching each file from the stand-in
 * YourTal's `/attachments/fetch` and acknowledging it at `/statements/ack`.
 * The capture, the CSV import and the credit spend are the real ones, as the
 * person, under RLS (snap_app).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const run = randomUUID().slice(0, 8);
const W_OWN = 'c7120000-0000-4000-8000-000000000001'; // ANA owns it
const W_MEMBER = 'c7120000-0000-4000-8000-000000000002'; // BEN owns it; ANA is only a member
const ANA = 'c7120000-0000-4000-8000-0000000000a1';
const BEN = 'c7120000-0000-4000-8000-0000000000a2';
const SUB = { ana: `stmt-ana-${run}`, ben: `stmt-ben-${run}` };
const STATEMENT = 'urn:yourtal:event:spambank-statement';
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

// Semicolon-delimited with a comma decimal mark: the workspace runs `id-2026` (see beforeAll),
// exactly as `csv-import.e2e.test.ts` does.
const CSV = Buffer.from(
  ['Date;Description;Amount', '01/06/2026;Opening Balance;1000,00', '05/06/2026;Salary;2000,00', '10/06/2026;Groceries;-150,00', '30/06/2026;Closing Balance;2850,00'].join('\n'),
  'utf8',
);

describeIfDb('statements from Spambank into SnapApp (T12)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let yt: FakeYourTalOidc;
  let keyDir: string;
  let workerPool: Pool;
  let workerDb: Db;
  let runErasureJobsOnce: (db: Db, log?: Pick<Console, 'log' | 'warn' | 'error'>, only?: string[]) => Promise<number>;
  let tokens: Map<string, string>;

  const offer = (emailId: string, blobId: string, bytes: Buffer, type: string) => {
    yt.spambank.attachments.set(`${emailId}/${blobId}`, { bytes, type });
    return { blob_id: blobId, name: `${blobId}.${type === 'text/csv' ? 'csv' : 'pdf'}`, type, size: bytes.byteLength };
  };

  const claims = (sub: string, body: object): JWTPayload => ({
    iss: yt.issuer,
    aud: yt.serverClientId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    sub_id: { format: 'iss_sub', iss: yt.issuer, sub },
    events: { [STATEMENT]: body },
  });

  /** Posts the SET, runs the worker for exactly that job, and returns the job row. */
  async function deliver(sub: string, emailId: string, attachments: object[]) {
    const c = claims(sub, { email_id: emailId, received_at: new Date().toISOString(), attachments });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/yourtal/events',
      headers: { 'content-type': 'application/secevent+jwt' },
      payload: await yt.signSet(c),
    });
    expect(res.statusCode).toBe(202);
    await runErasureJobsOnce(workerDb, quiet, [c.jti!]);
    return { jti: c.jti!, job: await jobRow(c.jti!) };
  }
  const jobRow = async (id: string) =>
    (await admin.query<{ completed_at: Date | null; last_error: string | null }>('select completed_at, last_error from jobs where id = $1', [id]))
      .rows[0]!;

  const importRow = async (emailId: string, blobId: string) =>
    (
      await admin.query<{ status: string; detail: string | null; tenant_id: string | null; capture_id: string | null; acked_at: Date | null }>(
        'select status, detail, tenant_id, capture_id, acked_at from mail_statement_imports where user_id = $1 and email_id = $2 and blob_id = $3',
        [ANA, emailId, blobId],
      )
    ).rows[0];
  const ackFor = (emailId: string, blobId: string) => yt.spambank.acks.filter((a) => a.emailId === emailId && a.blobId === blobId);
  const countIn = async (table: string, tenantId: string) =>
    Number((await admin.query<{ n: string }>(`select count(*)::text as n from ${table} where tenant_id = $1`, [tenantId])).rows[0]!.n);
  const chooseWorkspace = (tenantId: string | null) =>
    admin.query(
      `insert into mail_settings (user_id, import_tenant_id) values ($1, $2)
       on conflict (user_id) do update set import_tenant_id = excluded.import_tenant_id`,
      [ANA, tenantId],
    );

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-stmt-e2e-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_KEY_FILE = keyFile;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    process.env.YOURTAL_API_URL = yt.issuer.replace(/\/oidc$/, '');
    delete process.env.SPAMBANK_ENABLED;
    yt.spambank.addPerson(SUB.ana, { statementsToSnapApp: true });

    admin = await provisionTenant({
      tenantId: W_OWN,
      name: 'Ana household',
      users: [{ id: ANA, role: 'owner', subject: `yourtal|${SUB.ana}`, email: `ana-${run}@stmt.test` }],
      scanCredits: 5,
    });
    (
      await provisionTenant({
        tenantId: W_MEMBER,
        name: 'Ben business',
        users: [{ id: BEN, role: 'owner', subject: `yourtal|${SUB.ben}`, email: `ben-${run}@stmt.test` }],
        scanCredits: 5,
      })
    ).end();
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'member')`, [W_MEMBER, ANA]);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);

    workerPool = createPool(workerDatabaseUrl());
    workerDb = createDb(workerPool);
    ({ runErasureJobsOnce } = await import('../../yourtal/events-job.js'));
    (await import('../../yourtal/events-verify.js')).resetYourtalEventKeys();
    (await import('../../yourtal/oidc-client-api.js')).resetOidcClientApiCache();

    const { issueYourTalSession } = await import('../../auth/sessions.js');
    tokens = new Map([
      [ANA, await issueYourTalSession(ANA)],
      [BEN, await issueYourTalSession(BEN)],
    ]);

    const { AppModule } = await import('../../app.module.js');
    const { registerSecEventParser } = await import('../../yourtal/events.controller.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    registerSecEventParser(app.getHttpAdapter().getInstance());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // A CSV import reads dates and amounts by the workspace's rule set (csv-import.e2e.test.ts).
    const install = await app.inject({
      method: 'PUT',
      url: '/v1/tax-rules',
      headers: { authorization: `Bearer ${tokens.get(ANA)}`, 'x-workspace-id': W_OWN },
      payload: { rulesId: 'id-2026' },
    });
    expect(install.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query(`delete from jobs where kind = 'yourtal_event' and tenant_id is null and payload::text like $1`, [`%${run}%`]);
      await admin.query('delete from mail_statement_imports where user_id = any($1)', [[ANA, BEN]]);
      await admin.query('delete from mail_settings where user_id = any($1)', [[ANA, BEN]]);
      await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
      for (const t of [W_OWN, W_MEMBER]) {
        await admin.query('delete from jobs where tenant_id = $1', [t]);
        await admin.query('delete from credit_spends where tenant_id = $1', [t]).catch(() => undefined);
        await admin.query('delete from usage_grants where tenant_id = $1', [t]).catch(() => undefined);
        await admin.query('delete from capture_pages where tenant_id = $1', [t]).catch(() => undefined);
      }
      await wipeTenant(admin, W_MEMBER, [BEN]);
      await wipeTenant(admin, W_OWN, [ANA]);
      await admin.end();
    }
    const { closeDb } = await import('../../db.js');
    await closeDb();
    await workerPool?.end();
    await yt?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
    for (const name of ['YOURTAL_OIDC_ISSUER', 'YOURTAL_OIDC_KEY_FILE', 'YOURTAL_OIDC_SERVER_CLIENT_ID', 'YOURTAL_API_URL']) {
      delete process.env[name];
    }
  });

  beforeEach(async () => {
    yt.spambank.down = null;
    await chooseWorkspace(W_OWN);
  });

  it('a mailed CSV statement becomes a statement in the chosen workspace, and YourTal is told', async () => {
    const a = offer(`Mcsv${run}`, 'Bcsv1', CSV, 'text/csv');
    const { job } = await deliver(SUB.ana, `Mcsv${run}`, [a]);
    expect(job.completed_at).not.toBeNull();

    const row = await importRow(`Mcsv${run}`, 'Bcsv1');
    expect(row).toMatchObject({ status: 'imported', detail: 'statement: balance check pass', tenant_id: W_OWN });
    expect(row?.acked_at).not.toBeNull();
    expect(ackFor(`Mcsv${run}`, 'Bcsv1')).toEqual([
      { emailId: `Mcsv${run}`, blobId: 'Bcsv1', outcome: 'imported', detail: 'statement: balance check pass' },
    ]);

    const { rows } = await admin.query<{ balance_check: string; uploaded_by: string; mime: string }>(
      `select s.balance_check, c.uploaded_by, c.original_mime_type as mime
         from statements s join documents d on d.id = s.document_id join captures c on c.id = d.capture_id
        where c.id = $1`,
      [row!.capture_id],
    );
    expect(rows).toEqual([{ balance_check: 'pass', uploaded_by: ANA, mime: 'text/csv' }]);
  });

  it('the same file mailed again is a duplicate: no second statement', async () => {
    const before = await countIn('statements', W_OWN);
    const a = offer(`Mcsv2${run}`, 'Bcsv1', CSV, 'text/csv');
    await deliver(SUB.ana, `Mcsv2${run}`, [a]);
    expect(await importRow(`Mcsv2${run}`, 'Bcsv1')).toMatchObject({ status: 'duplicate', detail: 'already_captured' });
    expect(ackFor(`Mcsv2${run}`, 'Bcsv1').map((x) => x.outcome)).toEqual(['duplicate']);
    expect(await countIn('statements', W_OWN)).toBe(before);
  });

  it('a 3-page PDF statement is stored, charged one credit and queued for the statement reader', async () => {
    const bytes = statementPdf(3, run);
    const a = offer(`Mpdf${run}`, 'Bpdf1', bytes, 'application/pdf');
    const credits = async () =>
      Number((await admin.query<{ n: string }>(`select coalesce(sum(remaining), 0)::text as n from usage_grants where tenant_id = $1`, [W_OWN])).rows[0]!.n);
    const before = await credits();

    await deliver(SUB.ana, `Mpdf${run}`, [a]);
    const row = await importRow(`Mpdf${run}`, 'Bpdf1');
    expect(row).toMatchObject({ status: 'imported', detail: 'queued', tenant_id: W_OWN });
    expect(ackFor(`Mpdf${run}`, 'Bpdf1').map((x) => x.outcome)).toEqual(['imported']);

    const capture = (
      await admin.query<{ page_count: number; mime: string; uploaded_by: string; sha: string }>(
        `select page_count, original_mime_type as mime, uploaded_by, encode(original_sha256, 'hex') as sha from captures where id = $1`,
        [row!.capture_id],
      )
    ).rows[0];
    expect(capture).toMatchObject({ page_count: 3, mime: 'application/pdf', uploaded_by: ANA });
    expect(Number((await admin.query(`select count(*) from capture_pages where capture_id = $1`, [row!.capture_id])).rows[0].count)).toBe(3);
    // The original is the mailed file itself, byte for byte.
    const { readObject } = { readObject: (await import('../../storage.js')).get };
    const key = (await admin.query<{ key: string }>('select original_storage_key as key from captures where id = $1', [row!.capture_id])).rows[0]!.key;
    expect(createHash('sha256').update(readObject(key)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));

    const queued = await admin.query(`select 1 from jobs where tenant_id = $1 and kind = 'extract' and payload ->> 'captureId' = $2`, [W_OWN, row!.capture_id]);
    expect(queued.rows).toHaveLength(1);
    expect(await credits()).toBe(before - 1);
  });

  it('a password-protected PDF is skipped with a clear reason, and nothing is captured or charged', async () => {
    const captures = await countIn('captures', W_OWN);
    const a = offer(`Menc${run}`, 'Benc1', Buffer.from(ENCRYPTED_STATEMENT_PDF_B64, 'base64'), 'application/pdf');
    await deliver(SUB.ana, `Menc${run}`, [a]);
    expect(await importRow(`Menc${run}`, 'Benc1')).toMatchObject({ status: 'skipped', detail: 'password_protected', capture_id: null });
    expect(ackFor(`Menc${run}`, 'Benc1')).toEqual([{ emailId: `Menc${run}`, blobId: 'Benc1', outcome: 'skipped', detail: 'password_protected' }]);
    expect(await countIn('captures', W_OWN)).toBe(captures);
  });

  it('a workspace the person is only a member of gets nothing', async () => {
    await chooseWorkspace(W_MEMBER);
    const before = await countIn('captures', W_MEMBER);
    const a = offer(`Mmem${run}`, 'Bmem1', statementPdf(1, `${run}-member`), 'application/pdf');
    await deliver(SUB.ana, `Mmem${run}`, [a]);
    expect(await importRow(`Mmem${run}`, 'Bmem1')).toMatchObject({ status: 'skipped', detail: 'not_workspace_admin' });
    expect(await countIn('captures', W_MEMBER)).toBe(before);
  });

  it('the same event delivered twice imports once', async () => {
    const a = offer(`Mtwice${run}`, 'Btw1', statementPdf(2, `${run}-twice`), 'application/pdf');
    await deliver(SUB.ana, `Mtwice${run}`, [a]);
    const captures = await countIn('captures', W_OWN);
    await deliver(SUB.ana, `Mtwice${run}`, [a]);
    expect(await countIn('captures', W_OWN)).toBe(captures);
    expect(ackFor(`Mtwice${run}`, 'Btw1')).toHaveLength(1);
  });

  it('YourTal down: the job retries and the file is imported once it is back', async () => {
    const a = offer(`Mdown${run}`, 'Bdown1', statementPdf(1, `${run}-down`), 'application/pdf');
    yt.spambank.down = 'yourtal';
    const { jti, job } = await deliver(SUB.ana, `Mdown${run}`, [a]);
    expect(job.completed_at).toBeNull();
    expect(job.last_error).toMatch(/could not be fetched/);
    expect(await importRow(`Mdown${run}`, 'Bdown1')).toMatchObject({ status: 'pending' });

    yt.spambank.down = null;
    await admin.query('update jobs set run_after = now() where id = $1', [jti]);
    await runErasureJobsOnce(workerDb, quiet, [jti]);
    expect((await jobRow(jti)).completed_at).not.toBeNull();
    expect(await importRow(`Mdown${run}`, 'Bdown1')).toMatchObject({ status: 'imported', detail: 'queued' });
  });

  it('GET /v1/mail/imports lists the person’s own imports, newest first, and nobody else’s', async () => {
    const mine = await app.inject({ method: 'GET', url: '/v1/mail/imports', headers: { authorization: `Bearer ${tokens.get(ANA)}` } });
    expect(mine.statusCode).toBe(200);
    const items = mine.json().items as Array<{ fileName: string; status: string; reason: string; workspace: { id: string; name: string } | null; documentId: string | null; createdAt: string }>;
    expect(items.length).toBeGreaterThanOrEqual(6);
    const csv = items.find((i) => i.fileName === 'Bcsv1.csv' && i.status === 'imported');
    expect(csv).toMatchObject({ reason: 'statement', workspace: { id: W_OWN, name: 'Ana household' } });
    expect(csv?.documentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(items.find((i) => i.reason === 'password_protected')).toBeDefined();
    const times = items.map((i) => Date.parse(i.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);

    const bens = await app.inject({ method: 'GET', url: '/v1/mail/imports', headers: { authorization: `Bearer ${tokens.get(BEN)}` } });
    expect(bens.statusCode).toBe(200);
    expect(bens.json()).toEqual({ items: [] });

    const anonymous = await app.inject({ method: 'GET', url: '/v1/mail/imports' });
    expect(anonymous.statusCode).toBe(401);
  });
});
