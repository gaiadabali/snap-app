import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { voucherOwner, YourtalPartnerClient } from './client.js';
import { YourtalMerchantClient } from './merchant-client.js';
import { verifyMerchantSignature } from './merchant-signing.js';
import { verifyPartnerAuthorization } from './signing.js';

const KEY_ID = 'mc_0b6f4d3e-5a52-4a9e-9d58-6b0d7f3a2c11';
const SECRET = Buffer.alloc(32, 7);
const CODE = 'EWPVBEZFR0R3J1M5A';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  verified: ReturnType<typeof verifyMerchantSignature>;
}

let server: Server;
let baseUrl: string;
let seen: Seen[];
let respond: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

beforeEach(async () => {
  seen = [];
  respond = (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const entry: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
        verified: verifyMerchantSignature({
          header: req.headers['x-yourtal-signature'] as string | undefined,
          secret: SECRET,
          expectedKeyId: KEY_ID,
          method: req.method ?? '',
          pathAndQuery: req.url ?? '',
          idempotencyKey: (req.headers['idempotency-key'] as string | undefined) ?? '',
          body,
        }),
      };
      seen.push(entry);
      respond(req, res, entry);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(over: { timeoutMs?: number } = {}) {
  return new YourtalMerchantClient({ baseUrl, keyId: KEY_ID, secret: SECRET, ...over });
}

describe('YourtalMerchantClient', () => {
  it('signs exactly the bytes it sends, with the key and the Idempotency-Key, on each of the four routes', async () => {
    const c = client();
    await c.authorize(
      { code: CODE, amountMinor: 1500, currency: 'AUD', merchantOrderRef: 'ORD-1', orderTotalMinor: 4000 },
      'idem-1',
    );
    await c.capture({ authorizationId: 'auth-1', finalAmountMinor: 1400 }, 'idem-2');
    await c.void({ authorizationId: 'auth-1' }, 'idem-3');
    await c.lookup({ merchantOrderRef: 'ORD-1' }, 'idem-4');

    expect(seen.map((s) => s.url)).toEqual([
      '/v1/vouchers/authorize',
      '/v1/vouchers/capture',
      '/v1/vouchers/void',
      '/v1/vouchers/lookup',
    ]);
    expect(seen.map((s) => JSON.parse(s.body))).toEqual([
      { code: CODE, amount: 1500, currency: 'AUD', merchant_order_ref: 'ORD-1', order_total: 4000 },
      { authorization_id: 'auth-1', final_amount: 1400 },
      { authorization_id: 'auth-1' },
      { merchant_order_ref: 'ORD-1' },
    ]);
    seen.forEach((s, i) => {
      expect(s.method).toBe('POST');
      expect(s.verified).toEqual({ ok: true, keyId: KEY_ID });
      expect(s.headers['idempotency-key']).toBe(`idem-${i + 1}`);
      expect(s.headers['content-type']).toBe('application/json');
      expect(s.headers['x-yourtal-signature']).toMatch(/^t=\d+,k=mc_[0-9a-f-]+,v1=[0-9a-f]{64}$/);
    });
  });

  it('omits order_total when not given', async () => {
    await client().authorize({ code: CODE, amountMinor: 1, currency: 'AUD', merchantOrderRef: 'R' }, 'k');
    expect(JSON.parse(seen[0]!.body)).not.toHaveProperty('order_total');
  });

  it('requires an Idempotency-Key', async () => {
    await expect(client().lookup({ merchantOrderRef: 'R' }, '')).rejects.toThrow(/Idempotency-Key/);
    expect(seen).toHaveLength(0);
  });

  it('returns ok with the body and replay=false, or replay=true on Idempotent-Replay', async () => {
    respond = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ authorization_id: 'a1', amount_authorized: 1500 }));
    };
    expect(await client().authorize({ code: CODE, amountMinor: 1500, currency: 'AUD', merchantOrderRef: 'R' }, 'k')).toEqual({
      kind: 'ok',
      status: 200,
      body: { authorization_id: 'a1', amount_authorized: 1500 },
      replay: false,
    });

    respond = (_req, res) => {
      res.setHeader('Idempotent-Replay', 'true');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ authorization_id: 'a1' }));
    };
    const replayed = await client().authorize({ code: CODE, amountMinor: 1500, currency: 'AUD', merchantOrderRef: 'R' }, 'k');
    expect(replayed).toMatchObject({ kind: 'ok', replay: true });
  });

  it('turns {error:{type,code,message}} into a typed error, replay flag included', async () => {
    respond = (_req, res) => {
      res.statusCode = 409;
      res.setHeader('Idempotent-Replay', 'true');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { type: 'conflict_error', code: 'no_live_hold', message: 'no hold' } }));
    };
    expect(await client().capture({ authorizationId: 'x', finalAmountMinor: 1 }, 'k')).toEqual({
      kind: 'error',
      status: 409,
      code: 'no_live_hold',
      message: 'no hold',
      replay: true,
    });
  });

  it('keeps a status with a null code for a non-JSON error page', async () => {
    respond = (_req, res) => {
      res.statusCode = 502;
      res.end('<html>bad gateway</html>');
    };
    expect(await client().lookup({ merchantOrderRef: 'R' }, 'k')).toEqual({
      kind: 'error',
      status: 502,
      code: null,
      message: null,
      replay: false,
    });
  });

  it('reports a timeout as a network result', async () => {
    respond = () => {
      /* never answer */
    };
    const r = await client({ timeoutMs: 80 }).lookup({ merchantOrderRef: 'R' }, 'k');
    expect(r.kind).toBe('network');
  });

  it('refuses to follow a redirect, as a network result', async () => {
    respond = (_req, res) => {
      res.statusCode = 307;
      res.setHeader('Location', `${baseUrl}/elsewhere`);
      res.end();
    };
    const r = await client().lookup({ merchantOrderRef: 'R' }, 'k');
    expect(r.kind).toBe('network');
    expect(seen).toHaveLength(1);
  });

  it('reports a refused connection as a network result', async () => {
    const dead = new YourtalMerchantClient({ baseUrl: 'http://127.0.0.1:1', keyId: KEY_ID, secret: SECRET });
    expect((await dead.lookup({ merchantOrderRef: 'R' }, 'k')).kind).toBe('network');
  });

  it('never logs, and never puts a code, body or signature into a network error', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const dead = new YourtalMerchantClient({ baseUrl: 'http://127.0.0.1:1', keyId: KEY_ID, secret: SECRET });
    const r = await dead.authorize({ code: CODE, amountMinor: 1500, currency: 'AUD', merchantOrderRef: 'R' }, 'idem-secret-check');
    respond = (_req, res) => {
      res.statusCode = 422;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'code_invalid', message: 'nope' } }));
    };
    await client().authorize({ code: CODE, amountMinor: 1500, currency: 'AUD', merchantOrderRef: 'R' }, 'k');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(CODE);
    expect(JSON.stringify(r)).not.toMatch(/v1=|1500/);
  });
});

describe('voucherOwner (partner call)', () => {
  const PARTNER = 'snap-app';
  const PARTNER_SECRET = 'partner-secret';
  const LINK_ID = '3f0c2f0a-8d41-4f6e-8a55-1d6c4f2f9b10';
  const SHA = 'a'.repeat(64);

  function partner() {
    return new YourtalPartnerClient({ baseUrl, partnerId: PARTNER, secret: PARTNER_SECRET });
  }

  it('POSTs the link id and hash to /api/partners/vouchers/owner, signed like the other partner calls', async () => {
    respond = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ held: false }));
    };
    expect(await voucherOwner(partner(), { linkId: LINK_ID, codeSha256: SHA })).toEqual({ held: false });
    const s = seen[0]!;
    expect(s.url).toBe('/api/partners/vouchers/owner');
    expect(JSON.parse(s.body)).toEqual({ linkId: LINK_ID, codeSha256: SHA });
    expect(verifyPartnerAuthorization(s.headers.authorization, PARTNER, PARTNER_SECRET, s.body)).toBe(true);
    expect(s.headers['idempotency-key']).toBeTruthy();
  });

  it('returns the held answer when well-formed', async () => {
    respond = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ held: true, status: 'active', faceValueMinor: 2500, currency: 'AUD', expiresAt: '2027-01-01T00:00:00Z' }),
      );
    };
    expect(await voucherOwner(partner(), { linkId: LINK_ID, codeSha256: SHA })).toEqual({
      held: true,
      status: 'active',
      faceValueMinor: 2500,
      currency: 'AUD',
      expiresAt: '2027-01-01T00:00:00Z',
    });
  });

  it('is null for a malformed answer, an error status or a dead network', async () => {
    respond = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ held: true, status: 'active' }));
    };
    expect(await voucherOwner(partner(), { linkId: LINK_ID, codeSha256: SHA })).toBeNull();
    respond = (_req, res) => {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 'link_revoked' }));
    };
    expect(await voucherOwner(partner(), { linkId: LINK_ID, codeSha256: SHA })).toBeNull();
    const dead = new YourtalPartnerClient({ baseUrl: 'http://127.0.0.1:1', partnerId: PARTNER, secret: PARTNER_SECRET });
    expect(await voucherOwner(dead, { linkId: LINK_ID, codeSha256: SHA })).toBeNull();
  });
});
