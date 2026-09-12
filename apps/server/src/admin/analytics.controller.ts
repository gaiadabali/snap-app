import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminAnalyticsOverview,
  AdminQueueStat,
  AdminRetentionStatusRow,
  AdminSession,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, CurrentStaff, RequireCapability, StaffGuard } from './guards/staff.guard.js';

/**
 * Platform-wide aggregate analytics and operational read-outs.
 *
 * Every handler's return type below is a contract type from
 * `@snap/api-contract`, not an inferred shape — if this controller and the
 * contract ever drift, the build fails rather than shipping a silently
 * broken response.
 */
@ApiTags('admin')
@Controller('v1/admin')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
export class AdminAnalyticsController {
  @Get('me')
  @ApiOperation({ summary: 'Your own staff session: role and capabilities' })
  me(@CurrentStaff() session: AdminSession): AdminSession {
    return session;
  }

  @Get('analytics/overview')
  @RequireCapability('view_analytics')
  @ApiOperation({ summary: 'Users, tenants, scans, extraction success rate, cost vs revenue' })
  async overview(@CurrentUser() user: AuthUser): Promise<AdminAnalyticsOverview> {
    return adminRepo.getAnalyticsOverview(user.userId);
  }

  @Get('operations/queue')
  @RequireCapability('view_analytics')
  @ApiOperation({ summary: 'Queue depth and worker health, by job kind' })
  async queue(@CurrentUser() user: AuthUser): Promise<AdminQueueStat[]> {
    return adminRepo.getQueueStats(user.userId);
  }

  @Get('operations/retention')
  @RequireCapability('view_analytics')
  @ApiOperation({ summary: 'Retention/purge status: oldest kept document per tenant' })
  async retention(@CurrentUser() user: AuthUser): Promise<AdminRetentionStatusRow[]> {
    return adminRepo.getRetentionStatus(user.userId);
  }
}
