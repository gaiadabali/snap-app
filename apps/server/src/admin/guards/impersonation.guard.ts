import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { readSession } from '../../tokens.js';
import { getUser } from '../../repo.js';
import { hashImpersonationToken } from '../crypto/impersonation-tokens.js';
import { getMyCapabilities, verifyImpersonation } from '../admin.repo.js';

/**
 * Access to `GET /v1/admin/tenants/:tenantId/documents`, which a staff
 * member may reach two ways:
 *
 *   1. An ACTIVE IMPERSONATION TOKEN in `X-Impersonation-Token` — the token
 *      alone is the whole credential (no `Authorization` needed), exactly
 *      like an upload/download/image token (`apps/server/src/tokens.ts`).
 *      `admin_impersonation_verify` re-checks the "impersonate" capability
 *      and audits the request itself; this guard's own job is only to
 *      enforce the one thing the database function cannot know from a bare
 *      token hash — that the TENANT NAMED IN THE URL matches the tenant the
 *      session was actually started for. Without that check, a session
 *      opened for tenant A's customer would silently work against tenant B's
 *      documents too, because the token by itself proves nothing about which
 *      URL it is presented against.
 *   2. An ORDINARY STAFF SESSION with `read_tenant_records` and a `reason`
 *      query parameter — the non-impersonating path, for "pull up this one
 *      invoice for a support ticket" without opening a full session.
 *
 * These are deliberately two separate code paths rather than one guard chain
 * with an OR in it, so each stays exactly as strict as its own token format
 * requires — see `packages/db/test/admin_plane.test.ts` for the proof that
 * neither token format is accepted by the other's verifier.
 */

export type ImpersonationContext = {
  sessionId: string;
  staffUserId: string;
  subjectUserId: string;
  subjectTenantId: string;
};

type GuardedRequest = {
  headers?: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  method?: string;
  url?: string;
  authUser?: { userId: string };
  adminSession?: unknown;
  impersonation?: ImpersonationContext;
};

@Injectable()
export class TenantRecordsAccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const tenantId = request.params?.tenantId;
    if (!tenantId) throw new ForbiddenException('No tenant named in this request.');

    const impersonationToken = request.headers?.['x-impersonation-token'];
    if (impersonationToken) {
      const verified = await verifyImpersonation(
        hashImpersonationToken(impersonationToken),
        request.method ?? 'GET',
        request.url ?? '',
      );
      if (!verified) {
        throw new UnauthorizedException('That impersonation session is no longer valid.');
      }
      if (verified.subjectTenantId !== tenantId) {
        // The exact negative case the header comment names: a live session
        // for one tenant must not reach another's records.
        throw new ForbiddenException('That impersonation session is not for this tenant.');
      }
      request.impersonation = verified;
      return true;
    }

    // No impersonation token: fall back to an ordinary staff session. This
    // duplicates `SessionGuard`'s own lookup (readSession + getUser) rather
    // than composing Nest guards, because this route needs to accept EITHER
    // credential and Nest's guard chain has no OR — see the class comment.
    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const userId = readSession(token);
    if (!userId) throw new UnauthorizedException('Sign in to continue, or present an impersonation token.');
    const user = await getUser(userId);
    if (!user) throw new UnauthorizedException('That session is no longer valid.');
    request.authUser = user;

    const session = await getMyCapabilities(userId);
    if (!session || !session.capabilities.includes('read_tenant_records')) {
      throw new ForbiddenException('This action requires the "read_tenant_records" capability.');
    }
    request.adminSession = session;
    return true;
  }
}

/** Set only on the impersonation path; undefined on the ordinary-staff path. */
export const CurrentImpersonation = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ImpersonationContext | undefined => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    return request.impersonation;
  },
);

/**
 * Like `CurrentUser` (`common/auth.guard.ts`), but does not throw when
 * absent. On the impersonation path `TenantRecordsAccessGuard` never sets
 * `request.authUser` at all — the token is the whole credential, nobody
 * signed in — so the ordinary `CurrentUser` would refuse the request before
 * the handler ever got to check `CurrentImpersonation` instead.
 */
export const CurrentUserIfPresent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): { userId: string } | undefined => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    return request.authUser;
  },
);
