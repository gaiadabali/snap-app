import { Controller, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';

import { clientIp } from '../auth/client-ip.js';
import { RateLimiter } from '../auth/rate-limit.js';
import { getDb } from '../db.js';
import { EVENT, verifySet, YOURTAL_EVENT_JOB, yourtalEventsSettings } from './events-verify.js';

export const SECEVENT_CONTENT_TYPE = 'application/secevent+jwt';

/**
 * Parses `application/secevent+jwt` as text, 16 KB at most. main.ts registers
 * it for the real server, the e2e suite for its app; without it Fastify
 * answers 415 before the controller runs.
 */
export function registerSecEventParser(fastify: {
  addContentTypeParser: (
    type: string,
    opts: { parseAs: 'string'; bodyLimit: number },
    parser: (req: unknown, body: string, done: (err: Error | null, body?: string) => void) => void,
  ) => void;
}): void {
  fastify.addContentTypeParser(SECEVENT_CONTENT_TYPE, { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) =>
    done(null, body),
  );
}

// Counts FAILED deliveries only, per caller (the address Fastify walked to past
// our own proxies: unforgeable, client-ip.ts). A valid event is never throttled
// by someone else's junk; YourTal retries a 429 anyway.
const failuresPerIp = new RateLimiter(30, 60_000);

type Reply = {
  status: (code: number) => Reply;
  header: (name: string, value: string) => Reply;
  send: (body?: unknown) => void;
};

/**
 * YourTal's security events (group task 3.7, ticket S2; yourtal/docs/29 §4.3
 * and §6, docs/26 §2.3): `POST /v1/yourtal/events` with a Security Event
 * Token. No session and no Origin check: the signature is the credential.
 *
 * Verified, then in ONE transaction: the raw SET stored as a `yourtal_event`
 * job (id = jti, tenant NULL so it survives the erasure; a replay adds
 * nothing), and the account's sessions ended — all of them for
 * `account-deleted`, those opened before `iat` for `access-ended` (D3). The
 * erasure itself is the worker's, after it re-verifies the SET.
 *
 * Answers per RFC 8935: 202 (stored, or already seen), 400 {"err"} for a bad
 * token, 503 while not configured or while YourTal's keys cannot be fetched.
 * Logs the jti, the type and the outcome; never the token or the sub.
 */
@ApiTags('yourtal')
@Controller('v1/yourtal/events')
export class YourtalEventsController {
  private readonly logger = new Logger('yourtal-events');

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Receive a YourTal Security Event Token (RFC 8417 / RFC 8935)',
    description:
      'Body: a compact JWS, Content-Type application/secevent+jwt. 202 when stored or already seen; ' +
      '400 {"err": invalid_request | invalid_key | invalid_issuer | invalid_audience | authentication_failed}; ' +
      '429 after repeated bad tokens; 503 while not configured.',
  })
  async receive(
    @Req() request: { ip?: string; body?: unknown; headers: Record<string, string | string[] | undefined> },
    @Res() reply: Reply,
  ): Promise<void> {
    const settings = yourtalEventsSettings();
    if (!settings) {
      reply.status(503).header('retry-after', '3600').send({ error: 'not_configured' });
      return;
    }
    const limitKey = `yourtal-events:fail:${clientIp(request)}`;
    if (await failuresPerIp.exhausted(limitKey)) {
      reply.status(429).header('retry-after', '60').send({ error: 'rate_limited' });
      return;
    }

    const typeOk = String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() === SECEVENT_CONTENT_TYPE;
    const token = typeOk && typeof request.body === 'string' ? request.body.trim() : '';
    const result = token
      ? await verifySet(token, settings)
      : ({ ok: false, status: 400, err: 'invalid_request' } as const);

    if (!result.ok) {
      if (result.status === 400) {
        await failuresPerIp.consume(limitKey);
        this.logger.warn(`refused an event: ${result.err}`);
        reply.status(400).send({ err: result.err });
      } else {
        this.logger.error(`could not verify an event: ${result.reason}`);
        reply.status(503).header('retry-after', '60').send({ error: result.reason });
      }
      return;
    }

    const { jti, iat, sub, type } = result.set;
    // account-deleted ends every session; access-ended only those opened before
    // the event, so a late retry cannot end a newer one. Other types end none.
    const before =
      type === EVENT.accountDeleted ? sql`now()` : type === EVENT.accessEnded ? sql`to_timestamp(${iat})` : null;
    const { stored, revoked } = await getDb().transaction(async (tx) => {
      // No conflict target: naming `(id)` would make Postgres also demand a
      // SELECT policy, and the API must not read these rows (0044).
      const inserted = await tx.execute(sql`
        insert into jobs (id, tenant_id, kind, payload, max_attempts)
        values (${jti}::uuid, null, ${YOURTAL_EVENT_JOB}, ${JSON.stringify({ set: token })}::jsonb, 10)
        on conflict do nothing
      `);
      const ended = before
        ? await tx.execute<{ n: number }>(sql`select identity_yourtal_sessions_revoke(${sub}, ${before}) as n`)
        : null;
      return { stored: (inserted.rowCount ?? 0) > 0, revoked: ended?.rows[0]?.n ?? 0 };
    });
    this.logger.log(`event ${jti} ${type}: ${stored ? 'queued' : 'already seen'}, ${revoked} session(s) ended`);
    reply.status(202).send();
  }
}
