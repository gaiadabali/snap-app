import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
import type { AdminJobRef, AdminTriggerReextractionRequest } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

export class TriggerReextractionDto implements AdminTriggerReextractionRequest {
  @IsUUID() tenantId!: string;
  @IsUUID() captureId!: string;
  @IsString() reason!: string;
}

@ApiTags('admin')
@Controller('v1/admin/operations')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_operations')
export class AdminOperationsController {
  @Post('reextraction')
  @ApiOperation({
    summary: 'Re-queue extraction for one capture',
    description: 'Requires a reason; refused if the capture does not belong to the named tenant.',
  })
  async triggerReextraction(
    @CurrentUser() user: AuthUser,
    @ValidBody(TriggerReextractionDto) body: TriggerReextractionDto,
  ): Promise<AdminJobRef> {
    const jobId = await adminRepo.triggerReextraction(
      user.userId,
      body.tenantId,
      body.captureId,
      body.reason,
    );
    return { jobId };
  }
}
