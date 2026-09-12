import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminSession, PlatformCapability } from '@snap/api-contract';

import type { AuthUser } from '../../common/auth.guard.js';
import { getMyCapabilities } from '../admin.repo.js';

/**
 * Who is asking, on the admin plane, and are they platform staff at all?
 *
 * Mirrors the two-guard shape `apps/server/src/common/auth.guard.ts` already
 * uses (`SessionGuard` then `MembershipGuard`): `SessionGuard` runs FIRST on
 * every admin controller (ordinary sign-in — staff are users too), and THIS
 * guard is the fast-rejection layer on top, exactly as `MembershipGuard` is
 * to `withTenantAs`. It is not the security boundary. The boundary is that
 * every function in migration 0021 checks `staff_has_capability` itself,
 * from inside Postgres, regardless of whether this guard ran, was
 * misconfigured, or was skipped by a handler that forgot `@UseGuards` — see
 * `packages/db/test/admin_plane.test.ts`'s "a non-staff user" and "a staff
 * member is refused BY THE DATABASE" groups, which prove exactly that.
 */

type GuardedRequest = {
  authUser?: AuthUser;
  adminSession?: AdminSession;
  impersonation?: { staffUserId: string; subjectUserId: string };
};

@Injectable()
export class StaffGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('Sign in to continue.');

    // PRIVILEGE ESCALATION, CLOSED.
    //
    // `SessionGuard` sets `authUser` to the SUBJECT when a request carries an
    // impersonation token. Staff are ordinary users too, so if a staff member
    // impersonated ANOTHER STAFF MEMBER, this guard would look up the
    // subject's capabilities and hand the impersonator the subject's admin
    // powers — including `manage_staff`, which is enough to grant themselves
    // everything else. The impersonate capability would silently become every
    // capability.
    //
    // So the admin plane is unreachable under impersonation, full stop. It is
    // not a capability check, because the answer does not depend on who is
    // impersonating whom: acting-as is for using the product as a customer,
    // never for administering the platform.
    if (request.impersonation) {
      throw new ForbiddenException(
        'The admin plane cannot be used while impersonating. Stop the session first.',
      );
    }

    const session = await getMyCapabilities(user.userId);
    if (!session) throw new ForbiddenException('This account is not platform staff.');

    request.adminSession = session;
    return true;
  }
}

/** Names the capability a handler requires. Read by `CapabilityGuard`. */
export const RequireCapability = (capability: PlatformCapability) =>
  SetMetadata('admin:capability', capability);

/**
 * Enforces the capability named by `@RequireCapability`.
 *
 * Runs AFTER `StaffGuard` (which must appear first in `@UseGuards`) so
 * `request.adminSession` already exists. Refusing here is a convenience: the
 * SAME capability is re-checked, independently, inside the Postgres function
 * the handler goes on to call — this guard existing or not changes nothing
 * about whether the call can actually succeed.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Checks the HANDLER first, the CONTROLLER CLASS second — `@RequireCapability`
    // is used both ways (one shared capability for every route in a
    // controller, or a specific one per route), and `Reflector#get` alone
    // only ever sees the handler, silently ignoring a class-level decorator.
    const required = this.reflector.getAllAndOverride<PlatformCapability | undefined>('admin:capability', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; // no @RequireCapability on this handler or controller
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const session = request.adminSession;
    if (!session || !session.capabilities.includes(required)) {
      throw new ForbiddenException(`This action requires the "${required}" capability.`);
    }
    return true;
  }
}

/** The signed-in staff member's session, for a handler behind `StaffGuard`. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminSession => {
    const request: GuardedRequest = context.switchToHttp().getRequest();
    const session = request.adminSession;
    if (!session) throw new UnauthorizedException('Sign in to continue.');
    return session;
  },
);
