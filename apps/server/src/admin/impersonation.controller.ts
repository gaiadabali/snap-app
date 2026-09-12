import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import type { AdminImpersonationStartRequest, AdminImpersonationStartResponse, AdminImpersonationStopResponse } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { mintImpersonationToken } from './crypto/impersonation-tokens.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

/**
 * Type-level proof that this DTO cannot silently drift from the contract:
 * every field `AdminImpersonationStartRequest` requires must exist here with
 * a compatible type, or this file fails to compile. See the admin plane's
 * report for why this matters — a DTO and a contract type can both compile
 * and both be wrong at once if nothing ties them together.
 */
export class StartImpersonationDto implements AdminImpersonationStartRequest {
  @IsUUID() subjectUserId!: string;
  @IsUUID() subjectTenantId!: string;
  @IsString() reason!: string;
  @IsOptional() @IsInt() @Min(60) @Max(3600) ttlSeconds?: number;
}

@ApiTags('admin')
@Controller('v1/admin/impersonation')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
export class AdminImpersonationController {
  @Post('start')
  @RequireCapability('impersonate')
  @ApiOperation({
    summary: 'Start impersonating a user, inside their own tenant',
    description:
      'Mints a distinct, short-lived, revocable bearer token — never a normal session token, ' +
      'and never usable as one. `reason` is required and refused if blank; the database checks ' +
      'this again on its own regardless of anything this guard already verified.',
  })
  async start(
    @CurrentUser() user: AuthUser,
    @ValidBody(StartImpersonationDto) body: StartImpersonationDto,
  ): Promise<AdminImpersonationStartResponse> {
    const minted = mintImpersonationToken();
    const started = await adminRepo.startImpersonation(
      user.userId,
      body.subjectUserId,
      body.subjectTenantId,
      body.reason,
      minted.tokenHash,
      body.ttlSeconds,
    );
    return { sessionId: started.sessionId, token: minted.token, expiresAt: started.expiresAt };
  }

  @Post(':sessionId/stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'End an impersonation session before it expires' })
  async stop(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ): Promise<AdminImpersonationStopResponse> {
    // No `@RequireCapability` here: `admin_impersonation_stop` itself decides
    // who may end a session (the staff member who started it, or anyone with
    // "manage_staff") — see the migration. Gating on "impersonate" here would
    // be both redundant and wrong, since a "manage_staff" staff member who
    // never held "impersonate" must still be able to force-end someone else's.
    return adminRepo.stopImpersonation(user.userId, sessionId);
  }
}
