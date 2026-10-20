import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { verifyImpersonation } from '../admin/admin.repo.js';
import { hashImpersonationToken } from '../admin/crypto/impersonation-tokens.js';
import { authenticateSession } from '../auth/sessions.js';
import { getUser } from '../repo.js';
import type { AuthUser } from '@snap/api-contract';

/**
 * Who is asking, and may they act on this workspace?
 *
 * Two guards rather than one, because they answer different questions and
 * fail differently: no session is 401 ("say who you are"), and a session
 * without membership is 403 ("you are known, and not allowed"). Collapsing
 * them tells an attacker less but tells a legitimate client nothing useful.
 *
 * `MembershipGuard` is a fast rejection, not the security boundary. The real
 * boundary is `withTenantAs`, which re-checks membership inside the same
 * transaction as the query and cannot be bypassed by a handler that forgets
 * to apply a guard. This exists so the failure is a clean 403 instead of an
 * exception from the data layer.
 */

/**
 * Re-exported from the contract rather than declared again.
 *
 * It WAS declared here, without `initials`, and the two definitions were
 * structurally compatible enough that TypeScript never complained — so the
 * server happily returned a user with no initials and every screen in the app
 * crashed on `charCodeAt` of undefined the first time it rendered an avatar.
 * One definition, shared with the client, is the fix.
 */
export type { AuthUser };

/**
 * The bits of the request this module reads and writes.
 *
 * Declared locally rather than by augmenting Fastify's own interface: the
 * adapter is an implementation detail of `main.ts`, and augmenting a
 * transitive dependency's types couples every file that imports this one to
 * the HTTP server we happen to be using.
 */
type GuardedRequest = {
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  authUser?: AuthUser;
  tenantId?: string;
  method?: string;
  url?: string;
  impersonation?: ProductImpersonation;
  session?: CurrentSessionInfo;
};

/**
 * The session behind an ordinary signed-in request (0036). Absent under
 * impersonation, where nobody signed in as the subject and there is no
 * session of theirs to act on.
 */
export type CurrentSessionInfo = { sessionId: string; tokenHash: Buffer };

/**
 * Set when the request is being made by platform staff ACTING AS a user,
 * rather than by the user themselves.
 *
 * Its presence is what stops an impersonated request reaching the admin plane
 * (`StaffGuard` refuses outright when this is set) and what pins the request
 * to a single tenant in `MembershipGuard`.
 */
export type ProductImpersonation = {
  sessionId: string;
  staffUserId: string;
  subjectUserId: string;
  subjectTenantId: string;
};

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: GuardedRequest = context.switchToHttp().getRequest();

    // ── Impersonation ─────────────────────────────────────────────────────
    //
    // Platform staff acting as a user on the ORDINARY product API, not just
    // the admin plane. The token is the entire credential — there is no
    // `Authorization` header, because nobody signed in as the subject.
    //
    // `admin_impersonation_verify` re-checks the staff member's "impersonate"
    // capability, refuses an expired / stopped / revoked session, and AUDITS
    // this request with both identities. It is checked on every single call
    // rather than once at session start, which is what makes a revocation
    // take effect immediately instead of at the next login.
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

      const subject = await getUser(verified.subjectUserId);
      if (!subject) throw new UnauthorizedException('That impersonation session is no longer valid.');

      request.authUser = subject;
      request.impersonation = verified;
      return true;
    }

    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Sign in to continue.');

    // A signature alone proves only that this server minted the token. The
    // session row (0036) is what says it is still live: not signed out, not
    // revoked by a password change, not past its absolute or idle expiry,
    // and naming a user who still exists. Every one of those failures gets
    // the same answer — the client's only useful move is the same for all.
    const session = await authenticateSession(token);
    if (!session) {
      throw new UnauthorizedException({
        error: 'session_expired',
        message: 'Your session has ended. Sign in again.',
      });
    }

    request.authUser = session.user;
    request.session = { sessionId: session.sessionId, tokenHash: session.tokenHash };
    return true;
  }
}

/**
 * Refuses a signed-in user whose email address is not yet proven (1.2.b).
 *
 * WHAT AN UNVERIFIED ACCOUNT MAY DO: sign in, and use its own workspaces in
 * full — capture, review, export. Nothing there reaches anyone else, and
 * blocking it would punish the person for a slow inbox.
 *
 * WHAT IT MAY NOT: anything that acts on the address towards other people or
 * other services — inviting someone, accepting an invitation (which is
 * matched by email address, so an unproven address must not be enough), and
 * linking accounting software. Those are where an address someone typed but
 * does not own would do harm.
 *
 * Applied after `SessionGuard`. Under impersonation the subject's own status
 * decides, like every other check.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    if (!user.emailVerified) {
      throw new ForbiddenException({
        error: 'email_unverified',
        message:
          'Confirm your email address first. We sent you a link when you signed up, and you can ask for a new one in Settings.',
      });
    }
    return true;
  }
}

/**
 * Requires a workspace, taken from the `X-Workspace-Id` header.
 *
 * A header rather than a path segment because almost every endpoint is
 * workspace-scoped, and threading `/workspaces/:id/...` through all of them
 * makes the client build URLs by string concatenation — which is how a client
 * ends up sending the wrong id.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('Sign in to continue.');

    const tenantId = request.headers?.['x-workspace-id'] ?? request.query?.workspaceId;
    if (!tenantId) {
      throw new ForbiddenException('Send an X-Workspace-Id header naming the workspace.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new ForbiddenException('That is not a workspace id.');
    }

    // An impersonation session is opened FOR ONE TENANT and must not reach
    // another, however the client addresses the request. Without this, staff
    // who opened a session for one customer could switch the workspace header
    // and read a different customer's books under the same audited session —
    // the token itself proves nothing about which workspace it is presented
    // against.
    const impersonation = request.impersonation;
    if (impersonation && impersonation.subjectTenantId !== tenantId) {
      throw new ForbiddenException('That impersonation session is not for this workspace.');
    }

    request.tenantId = tenantId;
    return true;
  }
}

/** The signed-in user, for a handler that has passed `SessionGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    return user;
  },
);

/** The workspace, for a handler that has passed `MembershipGuard`. */
export const WorkspaceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const tenantId = request.tenantId;
    if (!tenantId) throw new ForbiddenException('No workspace on this request.');
    return tenantId;
  },
);

/** The session behind this request, for a handler that has passed `SessionGuard`. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentSessionInfo => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    // Absent under impersonation. A handler that acts on "my session" —
    // signing out everywhere, changing a password — must not run as staff
    // holding someone else's identity.
    if (!request.session) throw new ForbiddenException('This needs your own signed-in session.');
    return request.session;
  },
);

/**
 * The impersonation behind this request, if any. `undefined` for an ordinary
 * user request, which is the overwhelmingly common case.
 */
export const CurrentImpersonation = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProductImpersonation | undefined => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    return request.impersonation;
  },
);
