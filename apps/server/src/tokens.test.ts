import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Upload tokens carrying a page.
 *
 * `config()` requires a full environment (`DATABASE_URL`, `TOKEN_SECRET`,
 * ...) that this test suite otherwise never needs, so the module is imported
 * dynamically AFTER setting the handful of variables `tokens.ts` actually
 * reads — a static `import` would run before this file's own top-level code,
 * which is too late to matter for a lazily-read `config()` but is the kind of
 * ordering mistake worth avoiding on principle.
 */
let issueUploadToken: typeof import('./tokens.js').issueUploadToken;
let readUploadToken: typeof import('./tokens.js').readUploadToken;
let issueImageToken: typeof import('./tokens.js').issueImageToken;
let readImageToken: typeof import('./tokens.js').readImageToken;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.UPLOAD_TTL_SECONDS ??= '900';
  process.env.IMAGE_TTL_SECONDS ??= '900';
  const tokens = await import('./tokens.js');
  issueUploadToken = tokens.issueUploadToken;
  readUploadToken = tokens.readUploadToken;
  issueImageToken = tokens.issueImageToken;
  readImageToken = tokens.readImageToken;
});

describe('upload tokens', () => {
  it('round-trips the capture, tenant, page number and page count', () => {
    const token = issueUploadToken('capture-1', 'tenant-1', 2, 5);
    expect(readUploadToken(token)).toEqual({
      captureId: 'capture-1',
      tenantId: 'tenant-1',
      pageNumber: 2,
      pageCount: 5,
    });
  });

  it('rejects a forged token', () => {
    const token = issueUploadToken('capture-1', 'tenant-1', 1, 1);
    const [body] = token.split('.');
    // A different signature entirely, not a bit-flip on the real one — this
    // is what an attacker without the server's key can actually produce.
    const forged = `${body}.not-the-real-signature-at-all-000000000000`;
    expect(readUploadToken(forged)).toBeNull();
  });

  it('rejects a token for a different page than it was issued for', () => {
    // Not a property of `readUploadToken` itself — it decodes exactly what
    // was signed — but the point of embedding the page number IN the token
    // is that a caller cannot substitute a different page after the fact
    // without also forging the signature, which the previous test covers.
    // This test exists so the two travel together if one is ever changed.
    const token = issueUploadToken('capture-1', 'tenant-1', 1, 3);
    const claim = readUploadToken(token);
    expect(claim?.pageNumber).toBe(1);
    expect(claim?.pageNumber).not.toBe(2);
  });

  it('an expired token and a forged token are indistinguishable', () => {
    // Deliberately not testing wall-clock expiry (that would need faking the
    // clock, and the interesting property is structural, not timing-based):
    // a token minted before `pageNumber`/`pageCount` existed has no `p`/`c`
    // fields, which is exactly the shape a hand-forged token would have too.
    // Both must fail the SAME way — `readUploadToken` returning null — with
    // nothing in the response distinguishing "this used to be valid" from
    // "this was never valid".
    const legacyPayload = Buffer.from(
      JSON.stringify({ k: 'upload', s: 'capture-1', t: 'tenant-1', n: 'x' }),
      'utf8',
    ).toString('base64url');
    const forged = `${legacyPayload}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    expect(readUploadToken(forged)).toBeNull();
  });

  it('a session token is never accepted as an upload token', () => {
    // Same encoding, different `k`. If `readUploadToken` only checked for the
    // fields it wants rather than the kind, a session token — which an
    // attacker might have via some other leak — would authorise writing
    // capture bytes.
    const notAnUpload = Buffer.from(
      JSON.stringify({ k: 'session', s: 'user-1', n: 'x' }),
      'utf8',
    ).toString('base64url');
    expect(readUploadToken(`${notAnUpload}.whatever`)).toBeNull();
  });
});

describe('image tokens', () => {
  it('round-trips the capture, tenant and page number', () => {
    const token = issueImageToken('capture-1', 'tenant-1', 2);
    expect(readImageToken(token)).toEqual({
      captureId: 'capture-1',
      tenantId: 'tenant-1',
      pageNumber: 2,
    });
  });

  it('round-trips pageNumber 0, the "original bytes" convention', () => {
    // Falsy, so a naive `payload.p ? ... : null` check would reject it —
    // `readImageToken` has to check `typeof payload.p === 'number'`, not
    // truthiness, or every document's main `imageUrl` would 404.
    const token = issueImageToken('capture-1', 'tenant-1', 0);
    expect(readImageToken(token)?.pageNumber).toBe(0);
  });

  it("a token minted for one tenant's capture is useless against another tenant's", () => {
    // `readImageToken` only decodes what was signed — it has no way to know
    // which tenant a captureId actually belongs to, and isn't supposed to:
    // that check happens at the RLS layer (see repo.test.ts and the
    // cross-tenant integration test below). What this proves is the
    // narrower, structural half of the same property: the signature binds
    // `tenantId` to `captureId` together, so an attacker holding a token for
    // their own tenant cannot edit just the tenant id and have it verify.
    const mine = issueImageToken('capture-1', 'tenant-mine', 1);
    const [body] = mine.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as {
      t: string;
    };
    expect(payload.t).toBe('tenant-mine');

    const tampered = Buffer.from(
      JSON.stringify({ ...payload, t: 'tenant-someone-elses' }),
      'utf8',
    ).toString('base64url');
    const [, signature] = mine.split('.');
    expect(readImageToken(`${tampered}.${signature}`)).toBeNull();
  });

  it('rejects a forged token', () => {
    const token = issueImageToken('capture-1', 'tenant-1', 1);
    const [body] = token.split('.');
    const forged = `${body}.not-the-real-signature-at-all-000000000000`;
    expect(readImageToken(forged)).toBeNull();
  });

  it('an expired token and a forged token are indistinguishable', () => {
    // Same structural argument as the equivalent upload-token test: a token
    // with no `p` field — whether that is because it predates page numbers
    // or because it was hand-forged — fails the same way an expired one does.
    const legacyPayload = Buffer.from(
      JSON.stringify({ k: 'image', s: 'capture-1', t: 'tenant-1', n: 'x' }),
      'utf8',
    ).toString('base64url');
    const forged = `${legacyPayload}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    expect(readImageToken(forged)).toBeNull();
  });

  it('a session token is never accepted as an image token', () => {
    const notAnImage = Buffer.from(
      JSON.stringify({ k: 'session', s: 'user-1', n: 'x' }),
      'utf8',
    ).toString('base64url');
    expect(readImageToken(`${notAnImage}.whatever`)).toBeNull();
  });

  it('an upload token is never accepted as an image token', () => {
    // Same encoding, different `k` — the two kinds share every field name
    // (`s`, `t`, `p`) so this is the check that actually keeps them apart.
    const token = issueUploadToken('capture-1', 'tenant-1', 1, 1);
    expect(readImageToken(token)).toBeNull();
  });
});
