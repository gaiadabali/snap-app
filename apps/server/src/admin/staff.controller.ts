import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsUUID } from 'class-validator';
import type {
  AdminAddStaffRequest,
  AdminSetStaffCapabilityRequest,
  AdminStaffSummary,
  PlatformCapability,
  PlatformStaffRole,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

const ROLES = ['support', 'billing', 'operations', 'super_admin'] as const;
const CAPABILITIES = [
  'view_analytics',
  'view_tenant_metadata',
  'read_tenant_records',
  'impersonate',
  'manage_billing',
  'manage_platform_settings',
  'manage_ai_config',
  'manage_staff',
  'manage_operations',
] as const;

export class AddStaffDto implements AdminAddStaffRequest {
  @IsUUID() userId!: string;
  @IsIn(ROLES) role!: PlatformStaffRole;
  @IsArray() @IsIn(CAPABILITIES, { each: true }) capabilities!: PlatformCapability[];
}

export class SetStaffCapabilityDto implements AdminSetStaffCapabilityRequest {
  @IsIn(CAPABILITIES) capability!: PlatformCapability;
  @IsBoolean() grant!: boolean;
}

@ApiTags('admin')
@Controller('v1/admin/staff')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_staff')
export class AdminStaffController {
  @Get()
  @ApiOperation({ summary: 'Every platform staff member, active or revoked' })
  async list(@CurrentUser() user: AuthUser): Promise<AdminStaffSummary[]> {
    return adminRepo.listStaff(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Grant staff access to a user, with explicit capabilities — never a role alone' })
  async add(
    @CurrentUser() user: AuthUser,
    @ValidBody(AddStaffDto) body: AddStaffDto,
  ): Promise<AdminStaffSummary> {
    return adminRepo.addStaff(user.userId, body.userId, body.role, body.capabilities);
  }

  @Patch(':staffId/capabilities')
  @ApiOperation({ summary: 'Grant or revoke one capability' })
  async setCapability(
    @CurrentUser() user: AuthUser,
    @Param('staffId') staffId: string,
    @ValidBody(SetStaffCapabilityDto) body: SetStaffCapabilityDto,
  ): Promise<{ ok: true }> {
    await adminRepo.setStaffCapability(user.userId, staffId, body.capability, body.grant);
    return { ok: true };
  }

  @Post(':staffId/revoke')
  @ApiOperation({
    summary: 'Revoke a staff member entirely',
    description: 'Also ends any impersonation session they currently hold open.',
  })
  async revoke(@CurrentUser() user: AuthUser, @Param('staffId') staffId: string): Promise<{ ok: true }> {
    await adminRepo.revokeStaff(user.userId, staffId);
    return { ok: true };
  }
}
