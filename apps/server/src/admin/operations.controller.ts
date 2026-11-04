import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type {
  AdminJobRef,
  AdminResolveYourtalReviewRequest,
  AdminTriggerReextractionRequest,
  AdminYourtalReview,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

export class TriggerReextractionDto implements AdminTriggerReextractionRequest {
  @IsUUID() tenantId!: string;
  @IsUUID() captureId!: string;
  @IsString() reason!: string;
}

export class ResolveYourtalReviewDto implements AdminResolveYourtalReviewRequest {
  @IsString() @MinLength(1) @MaxLength(500) resolution!: string;
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

  @Get('yourtal-reviews')
  @ApiOperation({
    summary: 'Sign in with YourTal cases waiting for a person to decide',
    description: 'Open cases first; `?all=1` includes resolved ones. The email is masked and the YourTal sub is never returned.',
  })
  async yourtalReviews(@CurrentUser() user: AuthUser, @Query('all') all?: string): Promise<AdminYourtalReview[]> {
    return adminRepo.listYourtalReviews(user.userId, all !== '1');
  }

  @Post('yourtal-reviews/:id/resolve')
  @ApiOperation({
    summary: 'Close one open Sign in with YourTal case',
    description: 'Needs a written resolution; refused (404) once the case is no longer open. Audited.',
  })
  async resolveYourtalReview(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ValidBody(ResolveYourtalReviewDto) body: ResolveYourtalReviewDto,
  ): Promise<{ resolved: true }> {
    await adminRepo.resolveYourtalReview(user.userId, id, body.resolution);
    return { resolved: true };
  }
}
