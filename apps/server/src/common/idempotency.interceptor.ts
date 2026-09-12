import { createHash } from 'node:crypto';

import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import type { AuthUser } from '@snap/api-contract';

import { claimKey, recordOutcome, releaseKey } from './idempotency.repo.js';

/**
 * Makes a retried write happen once.
 *
 * Applied globally but deliberately INERT unless the client sends an
 * `Idempotency-Key`. That is the right default for two reasons: a caller that
 * has not thought about retries gets exactly today's behaviour, and the app
 * only needs this on the writes it queues offline — asking every endpoint to
 * opt in would mean the one that forgot is the one that duplicates a payment.
 *
 * Scoped to a workspace, because the storage table is. A write with no
 * workspace (signing in, onboarding) is not covered, and does not need to be:
 * both are already idempotent by construction — signing in finds-or-creates,
 * and onboarding's `workspace_create` is the thing being created.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers?: Record<string, string | undefined>;
      body?: unknown;
      url?: string;
      authUser?: AuthUser;
      tenantId?: string;
    }>();

    const key = request.headers?.['idempotency-key'];
    const method = (request.method ?? 'GET').toUpperCase();

    // A GET has nothing to make idempotent — it already is. Honouring a key on
    // one would cache a read, which is a different feature with different
    // invalidation rules, and getting those wrong shows stale money.
    if (!key || method === 'GET' || method === 'HEAD') return next.handle();

    const user = request.authUser;
    const tenantId = request.tenantId;
    if (!user || !tenantId) return next.handle();

    if (key.length > 200) {
      throw new BadRequestException('That Idempotency-Key is too long (200 characters max).');
    }

    // The METHOD and PATH are part of the identity of a request, not just its
    // body. Without them, one key reused across `POST /bills/x/pay` and
    // `DELETE /trips/y` — both with an empty body — would look identical, and
    // the second would replay the first's response instead of running.
    const requestHash = createHash('sha256')
      .update(`${method} ${request.url ?? ''}\n${JSON.stringify(request.body ?? null)}`)
      .digest();

    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();

    return from(claimKey(user.userId, tenantId, key, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.state === 'mismatch') {
          throw new ConflictException(
            'That Idempotency-Key was already used for a different request. Use a new key.',
          );
        }
        if (claim.state === 'in_flight') {
          // Genuinely concurrent, not a duplicate to be answered: the first
          // attempt has not finished, so there is no outcome to return yet.
          // 409 rather than a wait, because holding the connection is what
          // turns a slow write into two slow writes.
          throw new ConflictException(
            'That request is still being processed. Retry the same key in a moment.',
          );
        }
        if (claim.state === 'replay') {
          if (typeof response.statusCode === 'number') response.statusCode = claim.code;
          return of(claim.body);
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              // Recorded but NOT awaited: the write has already succeeded and
              // the caller is owed its response. A failure to record costs one
              // duplicate on an unlikely retry; blocking the response on it
              // costs every caller latency on every request.
              void recordOutcome(
                user.userId,
                tenantId,
                key,
                response.statusCode ?? 200,
                body ?? null,
              ).catch(() => {});
            },
            error: () => {
              // Nothing worth replaying. Released so the same key can be
              // retried and actually run, instead of answering "in progress"
              // forever and stranding the operation.
              void releaseKey(user.userId, tenantId, key).catch(() => {});
            },
          }),
        );
      }),
    );
  }
}
