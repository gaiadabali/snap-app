import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFakeYourtal, type FakeYourtal } from '../test-support/fake-yourtal.js';
import { YOURTAL_PATHS, YourtalPartnerClient } from './client.js';
import { receiptExternalRef } from './external-ref.js';
import { exchangeLinkCode, normaliseLinkCode, revokeLinkAtYourtal } from './link.service.js';
import { classifyActionResponse, OUTBOX_RETRY, retryDelaySeconds } from './outbox.js';
import { partnerAuthorization, partnerSignature, verifyPartnerAuthorization } from './signing.js';

/**
 * Ticket 2.5.a and the pure parts of 2.5.b/c. No database.
 *
 * The two vectors are copied verbatim from YourTal's guide
 * (yourtal/docs/developers/partner-api.md §3), signed there with the secret
 * `example-secret-not-real`. If these fail, every request we send fails with
 * 401 at YourTal.
 */
const GUIDE_SECRET = 'example-secret-not-real';
const VECTORS = [
  {
    body: '{"code":"K7QM4XPA"}',
    signature: '7ce9dd173825a395e170a772a0929b391477065dc8ca0a9e91c33587c20c1607',
  },
  {
    body: '{"linkId":"3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01","action":"receipt_scanned","externalRef":"rcpt_5d41402abc4b2a76b9719d911017c592","evidence":{"store":"Cafe Giro","totalMinor":450}}',
    signature: 'fe552000b602916a045bf117f3a57a254d0b8616e3258c4faabda66c8f3853c9',
  },
];

describe('the partner signer', () => {
  it.each(VECTORS)('matches the guide vector for $body', ({ body, signature }) => {
    expect(partnerSignature(GUIDE_SECRET, body)).toBe(signature);
    expect(partnerSignature(GUIDE_SECRET, Buffer.from(body, 'utf8'))).toBe(signature);
    expect(partnerAuthorization('snap-app', GUIDE_SECRET, body)).toBe(`Partner snap-app:${signature}`);
  });

  it('signs bytes, not meaning: re-serialised JSON is a different signature', () => {
    const body = VECTORS[0]!.body;
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(partnerSignature(GUIDE_SECRET, pretty)).not.toBe(VECTORS[0]!.signature);
    expect(partnerSignature(GUIDE_SECRET, `${body}\n`)).not.toBe(VECTORS[0]!.signature);
  });

  it('verifies its own header and refuses a wrong id, secret or body', () => {
    const body = VECTORS[1]!.body;
    const header = partnerAuthorization('snap-app', GUIDE_SECRET, body);
    expect(verifyPartnerAuthorization(header, 'snap-app', GUIDE_SECRET, body)).toBe(true);
    expect(verifyPartnerAuthorization(header, 'other-app', GUIDE_SECRET, body)).toBe(false);
    expect(verifyPartnerAuthorization(header, 'snap-app', 'another-example-secret', body)).toBe(false);
    expect(verifyPartnerAuthorization(header, 'snap-app', GUIDE_SECRET, `${body} `)).toBe(false);
    expect(verifyPartnerAuthorization(undefined, 'snap-app', GUIDE_SECRET, body)).toBe(false);
    expect(verifyPartnerAuthorization(header.toUpperCase(), 'snap-app', GUIDE_SECRET, body)).toBe(false);
  });
});

describe('receiptExternalRef', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const noRead = () => {
    throw new Error('must not read storage');
  };

  it('is the stored page hash for a one-photo receipt, without touching storage', () => {
    const h = sha('page one bytes');
    expect(
      receiptExternalRef(
        { mimeType: 'image/jpeg', storageKey: 'k', pageCount: 1, capturePageHashes: [h.toUpperCase()], receivedAt: '' },
        noRead,
      ),
    ).toBe(`sha256:${h}`);
  });

  it('is the hash of the page hashes, in page order, for a multi-photo receipt', () => {
    const a = sha('page a');
    const b = sha('page b');
    const ref = receiptExternalRef(
      { mimeType: 'image/jpeg', storageKey: 'k', pageCount: 2, capturePageHashes: [a, b], receivedAt: '' },
      noRead,
    );
    expect(ref).toBe(`sha256:${sha(a + b)}`);
    const swapped = receiptExternalRef(
      { mimeType: 'image/jpeg', storageKey: 'k', pageCount: 2, capturePageHashes: [b, a], receivedAt: '' },
      noRead,
    );
    expect(swapped).not.toBe(ref);
  });

  it('hashes the stored ORIGINAL file for a PDF, never its rendered pages', () => {
    const pdf = Buffer.from('%PDF-1.7 the original bytes');
    const renders = [sha('render 1'), sha('render 2')];
    const ref = receiptExternalRef(
      { mimeType: 'application/pdf', storageKey: 'tenant/originals/ab/x', pageCount: 2, capturePageHashes: renders, receivedAt: '' },
      (key) => {
        expect(key).toBe('tenant/originals/ab/x');
        return pdf;
      },
    );
    expect(ref).toBe(`sha256:${createHash('sha256').update(pdf).digest('hex')}`);
  });

  it('falls back to the stored original when the photographed pages are incomplete', () => {
    const bytes = Buffer.from('legacy single image');
    const ref = receiptExternalRef(
      { mimeType: 'image/png', storageKey: 'k', pageCount: 2, capturePageHashes: [sha('only one')], receivedAt: '' },
      () => bytes,
    );
    expect(ref).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  });
});

describe('outbox classification and backoff', () => {
  it('backs off 30s, 1m, 2m ... capped at 6h, and honours Retry-After', () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelaySeconds(n))).toEqual([30, 60, 120, 240, 480]);
    expect(retryDelaySeconds(10)).toBe(15360);
    expect(retryDelaySeconds(11)).toBe(6 * 3600);
    expect(retryDelaySeconds(OUTBOX_RETRY.maxAttempts)).toBe(6 * 3600);
    expect(retryDelaySeconds(1, 90)).toBe(90);
    // Total patience before an event is dead: about five days.
    let total = 0;
    for (let n = 1; n < OUTBOX_RETRY.maxAttempts; n++) total += retryDelaySeconds(n);
    expect(total / 86400).toBeGreaterThan(5);
    expect(total / 86400).toBeLessThan(6);
  });

  const err = (status: number, code: string | null, retryAfterSeconds: number | null = null) =>
    classifyActionResponse({ kind: 'error', status, code, message: null, retryAfterSeconds });

  it('maps every answer the ticket names', () => {
    expect(classifyActionResponse({ kind: 'ok', status: 200, body: { granted: true, points: 10, duplicate: false } })).toMatchObject({
      final: true,
      outcome: { status: 'sent', granted: true, points: 10 },
    });
    expect(classifyActionResponse({ kind: 'ok', status: 200, body: { granted: false, points: 0, duplicate: true } })).toMatchObject({
      final: true,
      outcome: { status: 'duplicate' },
    });
    expect(err(403, 'link_revoked')).toMatchObject({ final: true, outcome: { status: 'link_broken' }, brokenReason: 'link_revoked' });
    expect(err(400, 'unknown_link')).toMatchObject({ final: true, outcome: { status: 'link_broken' }, brokenReason: 'unknown_link' });
    for (const code of ['velocity_capped', 'insufficient_available', 'solvency_blocked', 'allocation_exhausted']) {
      expect(err(409, code)).toMatchObject({ final: true, outcome: { status: 'refused', code } });
    }
    expect(err(503, 'persistence_unavailable')).toMatchObject({ final: false, pauseBatch: true });
    expect(err(502, null)).toMatchObject({ final: false });
    expect(err(429, null, 30)).toMatchObject({ final: false, retryAfterSeconds: 30, pauseBatch: true });
    expect(err(409, 'idempotency_request_in_progress')).toMatchObject({ final: false, pauseBatch: false });
    expect(err(401, 'invalid_partner_signature')).toMatchObject({ final: false });
    expect(err(409, 'idempotency_key_reused')).toMatchObject({ final: true, outcome: { status: 'failed' } });
    expect(err(400, 'validation')).toMatchObject({ final: true, outcome: { status: 'failed' } });
    expect(classifyActionResponse({ kind: 'network', error: 'ECONNREFUSED' })).toMatchObject({ final: false, pauseBatch: true });
  });
});

describe('the client and the in-request calls, against the fake YourTal', () => {
  let fake: FakeYourtal;
  let client: YourtalPartnerClient;
  const noSleep = async () => {};

  beforeAll(async () => {
    fake = await startFakeYourtal();
    client = new YourtalPartnerClient({ baseUrl: fake.url, partnerId: fake.partnerId, secret: fake.secret, timeoutMs: 2000 });
  });
  afterAll(async () => {
    await fake.close();
  });

  it('sends the exact bytes it signed, with an Idempotency-Key', async () => {
    const raw = '{"code":"NOPE2222"}';
    const r = await client.post(YOURTAL_PATHS.links, raw, 'k-1');
    expect(r).toMatchObject({ kind: 'error', status: 400, code: 'invalid_link_code' });
    const seen = fake.requests.at(-1)!;
    expect(seen.raw).toBe(raw);
    expect(seen.signatureValid).toBe(true);
    expect(seen.idempotencyKey).toBe('k-1');
  });

  it('is refused by YourTal when signed with the wrong secret', async () => {
    const wrong = new YourtalPartnerClient({ baseUrl: fake.url, partnerId: fake.partnerId, secret: 'not-the-secret' });
    const r = await wrong.post(YOURTAL_PATHS.links, '{"code":"X"}', 'k-2');
    expect(r).toMatchObject({ kind: 'error', status: 401, code: 'invalid_partner_signature' });
  });

  it('reports a dead YourTal as a network failure, not a throw', async () => {
    const dead = new YourtalPartnerClient({ baseUrl: 'http://127.0.0.1:9', partnerId: 'snap-app', secret: 's', timeoutMs: 500 });
    expect((await dead.post('/x', '{}', 'k')).kind).toBe('network');
  });

  it('exchanges a code, refuses teens and spent codes, and revokes', async () => {
    const adult = fake.issueCode({ id: 'yt-adult', region: 'AU' });
    const linked = await exchangeLinkCode(client, adult, noSleep);
    expect(linked).toMatchObject({ ok: true, region: 'AU' });
    expect(await exchangeLinkCode(client, adult, noSleep)).toMatchObject({ ok: false, reason: 'invalid_link_code' });

    const teen = fake.issueCode({ id: 'yt-teen', region: 'AU', teen: true });
    expect(await exchangeLinkCode(client, teen, noSleep)).toMatchObject({ ok: false, reason: 'teen_consent_not_allowed' });

    if (!linked.ok) throw new Error('unreachable');
    expect(await revokeLinkAtYourtal(client, linked.linkId, noSleep)).toEqual({ ok: true });
    expect(fake.linkFor('yt-adult')?.revoked).toBe(true);
    // Again: already revoked is still success.
    expect(await revokeLinkAtYourtal(client, linked.linkId, noSleep)).toEqual({ ok: true });
  });

  it('retries a 503 inside the request with the same key and bytes', async () => {
    const code = fake.issueCode({ id: 'yt-retry', region: 'ID' });
    fake.inject({ status: 503, body: { code: 'persistence_unavailable' }, path: YOURTAL_PATHS.links });
    const before = fake.requests.length;
    const r = await exchangeLinkCode(client, code, noSleep);
    expect(r).toMatchObject({ ok: true, region: 'ID' });
    const tries = fake.requests.slice(before);
    expect(tries).toHaveLength(2);
    expect(tries[0]!.idempotencyKey).toBe(tries[1]!.idempotencyKey);
    expect(tries[0]!.raw).toBe(tries[1]!.raw);
  });

  it('gives up as unavailable when YourTal stays down', async () => {
    const code = fake.issueCode({ id: 'yt-down', region: 'AU' });
    fake.inject(
      { status: 503, body: {}, path: YOURTAL_PATHS.links },
      { status: 503, body: {}, path: YOURTAL_PATHS.links },
      { status: 503, body: {}, path: YOURTAL_PATHS.links },
    );
    expect(await exchangeLinkCode(client, code, noSleep)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('normalises what people type', () => {
    expect(normaliseLinkCode(' k7qm-4xpa ')).toBe('K7QM4XPA');
    expect(normaliseLinkCode('K7QM 4XPA')).toBe('K7QM4XPA');
    expect(normaliseLinkCode('')).toBeNull();
    expect(normaliseLinkCode('<script>')).toBeNull();
  });
});
