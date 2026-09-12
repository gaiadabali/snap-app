import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { asUser, withTenantAs, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { getDb } from '../db.js';
import { listMembers, listWorkspacesFor, updateTenant } from '../repo.js';
import { seedDefaultCategories } from '../settings/settings.repo.js';
import { setBudget } from '../business/business.repo.js';
import { abnIsValid } from '../extraction/validators.js';

const ROLES = ['owner', 'admin', 'bookkeeper', 'member', 'readonly'] as const;
type Role = (typeof ROLES)[number];

export class CreateWorkspaceDto {
  @IsString() name!: string;
  @IsIn(['business', 'personal']) kind!: 'business' | 'personal';
  @IsOptional() @IsString() abn?: string;
}

export class InviteDto {
  @IsEmail({}, { message: 'That does not look like an email address.' }) email!: string;
  @IsIn(ROLES) role!: Role;
}

export class AcceptInviteDto {
  @IsString() token!: string;
}

/** What a brand-new account has to answer before it can file anything. */
export class OnboardingDto {
  @IsString() workspaceName!: string;
  @IsIn(['business', 'personal']) kind!: 'business' | 'personal';
  @IsOptional() @IsString() abn?: string | null;
  @IsOptional() @IsBoolean() gstRegistered?: boolean;
  @IsOptional() @IsIn(['cash', 'accrual']) gstBasis?: 'cash' | 'accrual';
  @IsOptional() @IsString() occupationProfileId?: string | null;
  @IsOptional() @IsString() monthlyBudget?: string | null;
}

export class RoleDto {
  @IsIn(ROLES) role!: Role;
}

/**
 * Workspaces and the people in them.
 *
 * The permissions returned here are advisory for the CLIENT — they tell it
 * which controls to show. They are not the control itself: every write
 * re-checks server-side, because a UI that hides a button is a convenience and
 * an endpoint that refuses one is a boundary.
 */
@ApiTags('workspaces')
@Controller('v1/workspaces')
export class WorkspacesController {
  @Get()
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: 'The workspaces you belong to',
    description:
      'Answered with a user context and no tenant context — the one query that is legitimately made in that state.',
  })
  async list(@CurrentUser() user: AuthUser) {
    const workspaces = await listWorkspacesFor(getDb(), user.userId);
    const counted = await Promise.all(
      workspaces.map(async (w) => {
        const members = await listMembers(user.userId, w.id);
        return {
          id: w.id,
          name: w.name,
          kind: w.kind,
          role: w.role,
          memberCount: members.length,
          abn: null as string | null,
        };
      }),
    );
    return counted;
  }

  @Post()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Create a workspace and own it' })
  async create(@CurrentUser() user: AuthUser, @ValidBody(CreateWorkspaceDto) body: CreateWorkspaceDto) {
    const abn = body.kind === 'business' ? (body.abn?.replace(/\D/g, '') || null) : null;
    if (body.kind === 'personal' && body.abn) {
      // The database enforces this too (0012); refused here so the message is
      // about households rather than about a constraint name.
      throw new BadRequestException('A personal workspace does not have an ABN.');
    }

    // Creating a tenant happens outside tenant scope by necessity: there is no
    // context to run in until the row exists, so no policy on `tenants` can be
    // satisfied. `workspace_create` (migration 0015) is the one sanctioned way
    // through — it takes the owner from `app.user_id` rather than from an
    // argument, and inserts the tenant and its owner membership together, so a
    // workspace can never exist with nobody able to pay for or delete it.
    const id = await asUser(getDb(), user.userId, async (tx) => {
      const rows = await tx.execute<{ workspace_create: string }>(sql`
        select workspace_create(${body.name}, ${body.kind}::tenant_kind, ${abn}) as workspace_create
      `);
      return rows.rows[0]!.workspace_create;
    });
    // A workspace with no categories cannot categorise anything, and asking a
    // new user to invent a list before they have photographed a receipt is the
    // wrong first screen. Seeded per kind: a household is not offered "D1 —
    // car expenses", which is the whole reason the personal side is simpler.
    await seedDefaultCategories(user.userId, id, body.kind);
    return { id, name: body.name, kind: body.kind, role: 'owner', memberCount: 1, abn };
  }

  @Post('onboarding')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set up a brand-new account',
    description:
      'Creates the first workspace and everything that makes it usable: its tax settings, its category list, and a household budget if one was given. Returns the session, so the client does not have to re-fetch to discover it now belongs somewhere.',
  })
  async onboarding(
    @CurrentUser() user: AuthUser,
    @ValidBody(OnboardingDto) body: OnboardingDto,
  ) {
    const name = body.workspaceName.trim();
    if (name === '') throw new BadRequestException('Your workspace needs a name.');

    const digits = (body.abn ?? '').replace(/\D/g, '');
    if (body.kind === 'personal' && (digits !== '' || body.gstRegistered)) {
      throw new BadRequestException(
        'A household does not have an ABN and is not registered for GST.',
      );
    }
    if (digits !== '' && !abnIsValid(digits)) {
      throw new BadRequestException(
        'That ABN fails the ATO checksum — it is not a real ABN. Check for a transposed digit.',
      );
    }

    const created = await this.create(user, {
      name,
      kind: body.kind,
      ...(digits === '' ? {} : { abn: digits }),
    });

    // The rest of the answers, applied to the workspace that now exists.
    // Separate from creation because `workspace_create` is a SECURITY DEFINER
    // function and every field it accepts is a field it must then police; the
    // settings are an ordinary tenant write by someone who is already the owner.
    if (body.gstRegistered !== undefined || body.gstBasis || body.occupationProfileId) {
      await updateTenant(user.userId, created.id, {
        gstRegistered: body.gstRegistered,
        gstBasis: body.gstBasis,
        ...(body.occupationProfileId !== undefined
          ? { occupationProfileId: body.occupationProfileId || null }
          : {}),
      });
    }

    // A household that said what it intends to spend gets that recorded now,
    // so the tracker has something to measure against on the first screen
    // rather than after the first receipt.
    const budget = (body.monthlyBudget ?? '').trim();
    if (body.kind === 'personal' && budget !== '' && Number(budget) > 0) {
      await setBudget(user.userId, created.id, 'Everything else', budget);
    }

    return {
      user,
      workspaces: await listWorkspacesFor(getDb(), user.userId),
      workspaceId: created.id,
    };
  }

  @Get(':id/permissions')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({ summary: 'What you may do here' })
  async permissions(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    const members = await listMembers(user.userId, tenantId);
    const role = (members.find((m) => m.user_id === user.userId)?.role ?? 'readonly') as Role;
    return permissionsFor(role);
  }

  @Get(':id/members')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({ summary: 'Who is in this workspace, and the pending invitations' })
  async members(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    const members = await listMembers(user.userId, tenantId);
    const invitations = await withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      const rows = await t.execute<{
        id: string;
        email: string;
        role: string;
        invited_by_name: string | null;
        created_at: string;
        expires_at: string;
      }>(sql`
        select i.id, i.email::text as email, i.role,
               u.display_name as invited_by_name,
               i.created_at::text as created_at, i.expires_at::text as expires_at
          from invitations i
          left join users u on u.id = i.invited_by
         where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
         order by i.created_at desc
      `);
      return rows.rows;
    });

    const seats = await withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      const rows = await t.execute<{ seat_limit: number }>(sql`
        select coalesce(max(p.seat_limit), 1) as seat_limit
          from subscriptions s join plans p on p.id = s.plan_id
         where s.status in ('active', 'trialing')
      `);
      return rows.rows[0]?.seat_limit ?? 1;
    });

    return {
      members: members.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name ?? m.email ?? 'Unknown',
        email: m.email,
        role: m.role,
        initials: initialsOf(m.display_name ?? m.email ?? '?'),
        isYou: m.user_id === user.userId,
        joinedAt: m.created_at,
        lastActiveAt: null,
        captureCount: 0,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invitedByName: i.invited_by_name ?? 'Someone',
        createdAt: i.created_at,
        expiresAt: i.expires_at,
      })),
      seatLimit: seats,
      seatsUsed: members.length + invitations.length,
    };
  }

  @Post('invitations/accept')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Join a workspace you were invited to',
    description:
      'Takes the token from the invitation link. Deliberately NOT behind MembershipGuard: the whole point is that the caller is not a member yet.',
  })
  async accept(@CurrentUser() user: AuthUser, @ValidBody(AcceptInviteDto) body: AcceptInviteDto) {
    const tokenHash = createHash('sha256').update(body.token).digest();
    try {
      // Every rule — live invitation, the address it was sent to, the seat
      // limit, and not silently changing an existing role — is inside
      // `invitation_accept`, in one locked transaction. Splitting those checks
      // between here and there is how two people take the last seat.
      const joined = await asUser(getDb(), user.userId, async (tx) => {
        const rows = await tx.execute<{ tenant_id: string; role: string }>(sql`
          select tenant_id, role from invitation_accept(${tokenHash})
        `);
        return rows.rows[0] ?? null;
      });
      if (!joined) throw new NotFoundException('This invitation is no longer valid.');

      const workspaces = await listWorkspacesFor(getDb(), user.userId);
      const joinedWorkspace = workspaces.find((w) => w.id === joined.tenant_id);
      return {
        id: joined.tenant_id,
        role: joined.role,
        name: joinedWorkspace?.name ?? 'Workspace',
        kind: joinedWorkspace?.kind ?? 'business',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      // The function states its refusals as SQLSTATEs so they survive the
      // driver; they are translated once, here, rather than re-checked.
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const message = cause?.message ?? 'This invitation could not be accepted.';
      if (cause?.code === 'P0002') throw new NotFoundException(message);
      if (cause?.code === '42501') throw new ConflictException(message);
      if (cause?.code === '23514') throw new ConflictException(message);
      throw error;
    }
  }

  @Post(':id/invitations')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({
    summary: 'Invite someone',
    description:
      'Returns a single-use token that expires in seven days. Only the SHA-256 is stored, so a database disclosure does not hand out working join links.',
  })
  async invite(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(InviteDto) body: InviteDto,
  ) {
    await requireAdmin(user, tenantId);

    // The token is shown once, here, and never again. What is stored is its
    // hash — the same reasoning as a password.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest();

    return withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      const seats = await t.execute<{ used: number; limit: number }>(sql`
        -- Scoped explicitly: memberships_self is a PERMISSIVE policy and ORs
        -- with tenant isolation, so an unqualified count includes the caller's
        -- memberships in OTHER workspaces and reports too many seats used —
        -- refusing an invitation this workspace actually has room for.
        select (select count(*) from memberships
                 where tenant_id = current_tenant_id())::int
             + (select count(*) from invitations
                 where accepted_at is null and revoked_at is null and expires_at > now())::int as used,
               coalesce((select max(p.seat_limit) from subscriptions s
                           join plans p on p.id = s.plan_id
                          where s.status in ('active','trialing')), 1) as limit
      `);
      const row = seats.rows[0];
      if (row && row.used >= row.limit) {
        throw new ConflictException(
          `This plan includes ${row.limit} seats. Upgrade to invite more.`,
        );
      }

      try {
        const id = randomUUID();
        await t.execute(sql`
          insert into invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
          values (${id}, ${tenantId}, ${body.email.toLowerCase()}, ${body.role},
                  ${tokenHash}, ${user.userId}, now() + interval '7 days')
        `);
        return { id, token, email: body.email, role: body.role };
      } catch (error) {
        // The partial unique index refuses a second live invitation to the
        // same address — including a differently-cased one, because the column
        // is citext and NOAH@ is the same inbox as noah@.
        //
        // Detected from the Postgres error code and constraint name on the
        // CAUSE. Drizzle wraps the driver error, so `String(error)` is its own
        // "Failed query" message and matching on that silently never fired —
        // the duplicate surfaced as a 500.
        const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
        if (cause?.code === '23505' || cause?.constraint === 'invitations_one_pending_per_email') {
          throw new ConflictException(`${body.email} has already been invited.`);
        }
        throw error;
      }
    });
  }

  @Delete(':id/invitations/:invitationId')
  @UseGuards(SessionGuard, MembershipGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke an invitation' })
  async revoke(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('invitationId') invitationId: string,
  ) {
    await requireAdmin(user, tenantId);
    await withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      await t.execute(sql`
        update invitations set revoked_at = now()
         where id = ${invitationId} and tenant_id = ${tenantId}
      `);
    });
    return { revoked: true };
  }

  @Patch(':id/members/:userId')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({ summary: 'Change a role' })
  async setRole(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('userId') targetUserId: string,
    @ValidBody(RoleDto) body: RoleDto,
  ) {
    await requireAdmin(user, tenantId);
    await withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      await assertNotLastOwner(t, tenantId, targetUserId, body.role);
      // `tenant_id` is named explicitly even though row-level security also
      // scopes it. Defence in depth: while the server was connecting as a
      // superuser, RLS was silently inactive and this statement demoted the
      // user in EVERY workspace they belonged to. A predicate that duplicates
      // a policy costs nothing; relying on the policy alone cost that.
      await t.execute(sql`
        update memberships set role = ${body.role}
         where user_id = ${targetUserId} and tenant_id = ${tenantId}
      `);
    });
    return { userId: targetUserId, role: body.role };
  }

  @Delete(':id/members/:userId')
  @UseGuards(SessionGuard, MembershipGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove someone',
    description:
      'Their access ends. What they captured stays: the records belong to the workspace, which is required to keep them five years.',
  })
  async remove(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('userId') targetUserId: string,
  ) {
    await requireAdmin(user, tenantId);
    await withTenantAs(getDb(), user.userId, tenantId, async (t) => {
      await assertNotLastOwner(t, tenantId, targetUserId, null);
      await t.execute(sql`
        delete from memberships
         where user_id = ${targetUserId} and tenant_id = ${tenantId}
      `);
    });
    return { removed: true };
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function permissionsFor(role: Role) {
  const admin = role === 'owner' || role === 'admin';
  const canWrite = admin || role === 'member';
  return {
    canCapture: canWrite,
    canEdit: canWrite,
    // Anyone may photograph a receipt; posting it to the ledger is an
    // owner/admin act, because that is the entry an accountant is later held to.
    canConfirm: admin,
    canInvite: admin,
    canManageBudgets: admin,
    canBill: admin,
  };
}

async function requireAdmin(user: AuthUser, tenantId: string): Promise<void> {
  const members = await listMembers(user.userId, tenantId);
  const role = members.find((m) => m.user_id === user.userId)?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new ConflictException('Only an owner or manager can do that.');
  }
}

/** A workspace without an owner has nobody who can pay for it or delete it. */
async function assertNotLastOwner(
  t: Tx,
  tenantId: string,
  targetUserId: string,
  newRole: Role | null,
): Promise<void> {
  const owners = await t.execute<{ user_id: string }>(
    sql`select user_id from memberships where role = 'owner' and tenant_id = ${tenantId}`,
  );
  const list = owners.rows ?? [];
  if (list.length === 1 && list[0]?.user_id === targetUserId && newRole !== 'owner') {
    throw new ConflictException('A workspace must keep at least one owner.');
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export { NotFoundException };
