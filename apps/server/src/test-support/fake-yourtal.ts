import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { verifyPartnerAuthorization } from '../yourtal/signing.js';

/**
 * A fake YourTal partner API, in-process, for tests (group plan 2.5.d).
 *
 * It behaves like `yourtal/docs/developers/partner-api.md` on the points the
 * Snap Apps side depends on, and it CHECKS rather than trusts:
 *
 *   - every request's HMAC is verified over the raw bytes received, with the
 *     independent verifier, so a body re-serialised after signing fails here
 *     exactly as it would at YourTal (401 invalid_partner_signature);
 *   - an Idempotency-Key is required; the same key with the same bytes
 *     replays the first answer, the same key with different bytes is 409;
 *   - a link code works once; one YourTal user has one link per partner;
 *     teens are refused; a revoked link answers 403 link_revoked; a receipt
 *     pays once per externalRef.
 *
 * `inject` queues canned answers ahead of the normal logic, to simulate an
 * outage, a 429 or a ledger refusal on the next N calls.
 */

export interface FakeYourtalUser {
  id: string;
  region: 'AU' | 'ID';
  teen?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  raw: string;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  signatureValid: boolean;
}

interface Canned {
  status: number;
  body: unknown;
  /** Only for this path; any path when omitted. */
  path?: string;
}

export interface FakeYourtal {
  url: string;
  partnerId: string;
  secret: string;
  requests: RecordedRequest[];
  /** Issue a one-time link code for a YourTal user. */
  issueCode(user: FakeYourtalUser): string;
  /** End a link from YourTal's side (the user unlinked in YourTal). */
  revokeFromYourtal(linkId: string): void;
  linkFor(yourtalUserId: string): { linkId: string; revoked: boolean } | undefined;
  /** externalRef -> linkId that was paid for it. */
  paid: Map<string, string>;
  inject(...answers: Canned[]): void;
  /**
   * Receipt package used up (F127): actions answer 409 `allocation_exhausted`
   * and the receipt status says `earning: false`. Off by default.
   */
  setPaused(paused: boolean): void;
  /**
   * YourTal's identity check (5.9.c): while set, actions answer
   * `403 identity_check_required` with this `missing` list, as documented.
   * `null` turns it off. Off by default.
   */
  setIdentityCheck(missing: string[] | null): void;
  /** Runs after the signature check and before the answer: lets a test interleave a race. */
  onRequest: ((path: string) => Promise<void>) | null;
  close(): Promise<void>;
}

const POINTS = { AU: 10, ID: 100 } as const;

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startFakeYourtal(options: { partnerId?: string; secret?: string } = {}): Promise<FakeYourtal> {
  const partnerId = options.partnerId ?? 'snap-app';
  const secret = options.secret ?? 'example-secret-not-real';

  const codes = new Map<string, { user: FakeYourtalUser; used: boolean }>();
  const links = new Map<string, { linkId: string; user: FakeYourtalUser; revokedAt: string | null }>(); // by yourtal user id
  const byLinkId = new Map<string, { linkId: string; user: FakeYourtalUser; revokedAt: string | null }>();
  const paid = new Map<string, string>();
  const idempotency = new Map<string, { raw: string; status: number; body: unknown }>();
  const canned: Canned[] = [];
  const requests: RecordedRequest[] = [];
  let codeCounter = 0;
  let paused = false;
  let identityMissing: string[] | null = null;

  function handle(path: string, raw: string): { status: number; body: unknown } {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { status: 400, body: { code: 'validation', message: 'not json' } };
    }

    if (path === '/api/partners/links') {
      const entry = typeof body.code === 'string' ? codes.get(body.code) : undefined;
      if (!entry || entry.used) return { status: 400, body: { code: 'invalid_link_code', message: 'unknown, expired or used' } };
      if (entry.user.teen) return { status: 403, body: { code: 'teen_consent_not_allowed', message: 'teen' } };
      entry.used = true;
      let link = links.get(entry.user.id);
      if (!link || link.revokedAt) {
        link = { linkId: randomUUID(), user: entry.user, revokedAt: null };
        links.set(entry.user.id, link);
        byLinkId.set(link.linkId, link);
      }
      return { status: 200, body: { linkId: link.linkId, region: entry.user.region, createdAt: new Date().toISOString() } };
    }

    const revoke = /^\/api\/partners\/links\/([^/]+)\/revoke$/.exec(path);
    if (revoke) {
      const link = byLinkId.get(decodeURIComponent(revoke[1]!));
      if (!link) return { status: 400, body: { code: 'unknown_link', message: 'no such link' } };
      link.revokedAt ??= new Date().toISOString();
      return { status: 200, body: { linkId: link.linkId, revokedAt: link.revokedAt } };
    }

    if (path === '/api/partners/actions') {
      if (body.action !== 'receipt_scanned' || typeof body.externalRef !== 'string' || typeof body.linkId !== 'string') {
        return { status: 400, body: { code: 'validation', message: 'bad body' } };
      }
      const link = byLinkId.get(body.linkId);
      if (!link) return { status: 400, body: { code: 'unknown_link', message: 'no such link' } };
      if (link.revokedAt) return { status: 403, body: { code: 'link_revoked', message: 'link again' } };
      if (identityMissing) {
        return {
          status: 403,
          body: {
            code: 'identity_check_required',
            message: 'Verify your email, or use a permanent email address, to earn points.',
            linkId: link.linkId,
            missing: identityMissing,
          },
        };
      }
      if (paused) {
        return {
          status: 409,
          body: {
            code: 'allocation_exhausted',
            message: 'receipt points are paused: the receipt package is used up',
            linkId: link.linkId,
          },
        };
      }
      const earlier = paid.get(body.externalRef);
      if (earlier) {
        const same = earlier === link.linkId;
        return {
          status: 200,
          body: { granted: same, points: same ? POINTS[link.user.region] : 0, linkId: link.linkId, duplicate: true },
        };
      }
      paid.set(body.externalRef, link.linkId);
      return { status: 200, body: { granted: true, points: POINTS[link.user.region], linkId: link.linkId, duplicate: false } };
    }

    if (path === '/api/partners/receipts/status') {
      const region = body.region;
      if (region !== 'AU' && region !== 'ID') return { status: 400, body: { code: 'validation', message: 'region' } };
      return {
        status: 200,
        body: {
          region,
          earning: !paused,
          pointsPerReceipt: region === 'AU' ? 1 : 10,
          remainingPoints: paused ? 0 : 412,
        },
      };
    }

    return { status: 404, body: { code: 'not_found', message: path } };
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readRaw(req);
      const path = (req.url ?? '').split('?')[0]!;
      const authorization = req.headers.authorization;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      const signatureValid = verifyPartnerAuthorization(authorization, partnerId, secret, raw);
      requests.push({ method: req.method ?? '', path, raw, authorization, idempotencyKey, signatureValid });

      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (req.method !== 'POST') return send(405, { code: 'method_not_allowed' });
      if (!signatureValid) return send(401, { code: 'invalid_partner_signature', message: 'bad signature' });
      if (!idempotencyKey) return send(400, { code: 'idempotency_key_required', message: 'add one' });

      if (fake.onRequest) await fake.onRequest(path);

      const cannedIndex = canned.findIndex((c) => !c.path || c.path === path);
      if (cannedIndex >= 0) {
        const [c] = canned.splice(cannedIndex, 1);
        return send(c!.status, c!.body);
      }

      const seen = idempotency.get(`${partnerId}:${idempotencyKey}`);
      if (seen) {
        if (seen.raw !== raw) return send(409, { code: 'idempotency_key_reused', message: 'new key please' });
        return send(seen.status, seen.body);
      }
      const answer = handle(path, raw);
      idempotency.set(`${partnerId}:${idempotencyKey}`, { raw, ...answer });
      return send(answer.status, answer.body);
    })().catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const fake: FakeYourtal = {
    url: `http://127.0.0.1:${port}`,
    partnerId,
    secret,
    requests,
    paid,
    issueCode(user) {
      codeCounter += 1;
      // The real alphabet (no I, O, 0, 1); deterministic, not random-looking.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let n = codeCounter;
      let suffix = '';
      for (let i = 0; i < 4; i++) {
        suffix = alphabet[n % 32]! + suffix;
        n = Math.floor(n / 32);
      }
      const code = `TEST${suffix}`;
      codes.set(code, { user, used: false });
      return code;
    },
    revokeFromYourtal(linkId) {
      const link = byLinkId.get(linkId);
      if (link) link.revokedAt ??= new Date().toISOString();
    },
    linkFor(yourtalUserId) {
      const link = links.get(yourtalUserId);
      return link ? { linkId: link.linkId, revoked: link.revokedAt !== null } : undefined;
    },
    inject(...answers) {
      canned.push(...answers);
    },
    setPaused(value) {
      paused = value;
    },
    setIdentityCheck(missing) {
      identityMissing = missing;
    },
    onRequest: null,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return fake;
}
