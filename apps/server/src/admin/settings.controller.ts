import { Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDefined, IsString } from 'class-validator';
import type { AdminPlatformSetting, AdminSetSettingRequest } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

export class SetSettingDto implements AdminSetSettingRequest {
  // `@IsDefined()` rather than nothing: the global `ValidationPipe` runs with
  // `whitelist: true, forbidNonWhitelisted: true` (`main.ts`), which strips —
  // and then REJECTS — any property with no validation decorator at all. An
  // undecorated `value: unknown` would silently vanish from every request.
  @IsDefined() value!: unknown;
  @IsString() reason!: string;
}

@ApiTags('admin')
@Controller('v1/admin/settings')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_platform_settings')
export class AdminSettingsController {
  @Get()
  @ApiOperation({ summary: 'Platform settings' })
  async list(@CurrentUser() user: AuthUser): Promise<AdminPlatformSetting[]> {
    return adminRepo.listSettings(user.userId);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Change one platform setting', description: 'Requires a reason; audited.' })
  async set(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @ValidBody(SetSettingDto) body: SetSettingDto,
  ): Promise<AdminPlatformSetting> {
    await adminRepo.setSetting(user.userId, key, body.value, body.reason);
    const all = await adminRepo.listSettings(user.userId);
    return all.find((s) => s.key === key)!;
  }
}
