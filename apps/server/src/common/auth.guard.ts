import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { getUser } from '../repo.js';
import { readSession } from '../tokens.js';
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
};

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    const userId = readSession(token);
    if (!userId) throw new UnauthorizedException('Sign in to continue.');

    const user = await getUser(userId);
    // A token can outlive the user it names — a deleted account, a restored
    // database. A signature alone is not proof the subject still exists.
    if (!user) throw new UnauthorizedException('That session is no longer valid.');

    request.authUser = user;
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
