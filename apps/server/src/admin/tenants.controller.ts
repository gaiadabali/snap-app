import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminTenantDetail,
  AdminTenantDocumentsView,
  AdminTenantSummary,
  AdminUserSummary,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';
import {
  CurrentImpersonation,
  CurrentUserIfPresent,
  TenantRecordsAccessGuard,
  type ImpersonationContext,
} from './guards/impersonation.guard.js';

function clampLimit(raw: string | undefined): number {
  const n = Number(raw ?? 25);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 25;
}
function clampOffset(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

@ApiTags('admin')
@Controller('v1/admin')
export class AdminTenantsController {
  @Get('tenants')
  @UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
  @RequireCapability('view_tenant_metadata')
  @ApiOperation({ summary: 'Search tenants by name or ABN' })
  async searchTenants(
    @CurrentUser() user: AuthUser,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AdminTenantSummary[]> {
    return adminRepo.searchTenants(user.userId, query ?? null, clampLimit(limit), clampOffset(offset));
  }

  @Get('tenants/:tenantId')
  @UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
  @RequireCapability('view_tenant_metadata')
  @ApiOperation({ summary: "One tenant's metadata. Logged as a staff view." })
  async tenantDetail(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
  ): Promise<AdminTenantDetail> {
    return adminRepo.getTenantDetail(user.userId, tenantId);
  }

  @Get('users')
  @UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
  @RequireCapability('view_tenant_metadata')
  @ApiOperation({ summary: 'Search users by email or name' })
  async searchUsers(
    @CurrentUser() user: AuthUser,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AdminUserSummary[]> {
    return adminRepo.searchUsers(user.userId, query ?? null, clampLimit(limit), clampOffset(offset));
  }

  /**
   * A staff read of one tenant's actual records — the "read_tenant_records"
   * capability, or an active impersonation session for this exact tenant.
   * See `TenantRecordsAccessGuard` for the two-path design, and the
   * migration header (rule 5) for why the authorisation decision and the
   * data read are two separate steps.
   */
  @Get('tenants/:tenantId/documents')
  @UseGuards(TenantRecordsAccessGuard)
  @ApiOperation({
    summary: "A tenant's documents, for support or compliance",
    description:
      'Without an impersonation token, `reason` is required and the read is audited with it. ' +
      'With `X-Impersonation-Token`, the session already carries its own reason and audit trail.',
  })
  async tenantDocuments(
    @CurrentUserIfPresent() user: { userId: string } | undefined,
    @CurrentImpersonation() impersonation: ImpersonationContext | undefined,
    @Param('tenantId') tenantId: string,
    @Query('reason') reason?: string,
  ): Promise<AdminTenantDocumentsView> {
    if (impersonation) {
      // Already authorised and audited by `admin_impersonation_verify` on
      // the way in — see `TenantRecordsAccessGuard`. Read the same rows a
      // member of this tenant would see, no separate reason needed.
      return adminRepo.getImpersonatedTenantDocuments(impersonation.subjectTenantId);
    }
    if (!user) throw new BadRequestException('No caller identity on this request.');
    const trimmed = (reason ?? '').trim();
    if (trimmed === '') {
      throw new BadRequestException('A `reason` query parameter is required to read a tenant\'s records.');
    }
    return adminRepo.getTenantDocuments(user.userId, tenantId, trimmed);
  }
}
