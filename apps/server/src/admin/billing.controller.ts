import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString, IsUUID } from 'class-validator';
import type {
  AdminPlanSummary,
  AdminSetPlanRequest,
  AdminSubscriptionRef,
  AdminUsageGrantRef,
  AdminUsageGrantRequest,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

export class SetPlanDto implements AdminSetPlanRequest {
  @IsUUID() planId!: string;
  @IsString() reason!: string;
}

export class UsageGrantDto implements AdminUsageGrantRequest {
  @IsString() metric!: string;
  @IsInt() @IsPositive() amount!: number;
  @IsString() reason!: string;
}

@ApiTags('admin')
@Controller('v1/admin')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_billing')
export class AdminBillingController {
  @Get('plans')
  @ApiOperation({ summary: 'The plan catalogue' })
  async plans(@CurrentUser() user: AuthUser): Promise<AdminPlanSummary[]> {
    return adminRepo.listPlans(user.userId);
  }

  @Post('tenants/:tenantId/plan')
  @ApiOperation({ summary: "Change a tenant's plan", description: 'Requires a reason; audited.' })
  async setPlan(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @ValidBody(SetPlanDto) body: SetPlanDto,
  ): Promise<AdminSubscriptionRef> {
    const subscriptionId = await adminRepo.setTenantPlan(user.userId, tenantId, body.planId, body.reason);
    return { subscriptionId };
  }

  @Post('tenants/:tenantId/usage-grants')
  @ApiOperation({ summary: 'Grant top-up usage (e.g. extra scans) to a tenant' })
  async grantUsage(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @ValidBody(UsageGrantDto) body: UsageGrantDto,
  ): Promise<AdminUsageGrantRef> {
    const usageGrantId = await adminRepo.grantUsage(
      user.userId,
      tenantId,
      body.metric,
      body.amount,
      body.reason,
    );
    return { usageGrantId };
  }
}
