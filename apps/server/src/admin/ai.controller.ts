import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import type {
  AdminAiKeyRef,
  AdminAiProviderConfig,
  AdminAiUsageStat,
  AdminRevokeAiKeyRequest,
  AdminSetAiKeyRequest,
  AdminUpsertAiProviderRequest,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as adminRepo from './admin.repo.js';
import { encryptApiKey } from './crypto/kms.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

export class UpsertAiProviderDto implements AdminUpsertAiProviderRequest {
  @IsString() provider!: string;
  @IsString() label!: string;
  @IsOptional() @IsString() defaultModel?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetAiKeyDto implements AdminSetAiKeyRequest {
  @IsString() @MinLength(8) apiKey!: string;
}

export class RevokeAiKeyDto implements AdminRevokeAiKeyRequest {
  @IsString() reason!: string;
}

/**
 * AI provider / model / key configuration and usage.
 *
 * `POST .../key` is the ONLY place a plaintext key crosses into this
 * process from the wire, and it never crosses back out — see
 * `AdminAiProviderConfig`, which carries only `keyPrefix`/`keyLast4`, and
 * `crypto/kms.ts`'s header for why the ciphertext is app-level AEAD under a
 * KMS-wrapped DEK rather than `pgcrypto`.
 */
@ApiTags('admin')
@Controller('v1/admin/ai')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_ai_config')
export class AdminAiController {
  @Get('providers')
  @ApiOperation({ summary: 'Configured AI providers — never a key, only a prefix/last4' })
  async providers(@CurrentUser() user: AuthUser): Promise<AdminAiProviderConfig[]> {
    return adminRepo.listAiProviders(user.userId);
  }

  @Post('providers')
  @ApiOperation({ summary: 'Add or update a provider configuration' })
  async upsertProvider(
    @CurrentUser() user: AuthUser,
    @ValidBody(UpsertAiProviderDto) body: UpsertAiProviderDto,
  ): Promise<AdminAiProviderConfig> {
    await adminRepo.upsertAiProvider(
      user.userId,
      body.provider,
      body.label,
      body.defaultModel ?? null,
      body.isActive ?? true,
    );
    const all = await adminRepo.listAiProviders(user.userId);
    return all.find((p) => p.label === body.label)!;
  }

  @Post('providers/:configId/key')
  @ApiOperation({
    summary: 'Set (rotate) the API key for a provider',
    description:
      'The key is encrypted here, in this process, before it ever reaches Postgres — ' +
      'app-level AEAD with a KMS-wrapped DEK, never `pgcrypto`. The response never repeats it.',
  })
  async setKey(
    @CurrentUser() user: AuthUser,
    @Param('configId') configId: string,
    @ValidBody(SetAiKeyDto) body: SetAiKeyDto,
  ): Promise<AdminAiKeyRef> {
    // `await` as of docs/INTEGRATIONS.md K1: a real KMS wraps over the
    // network, so the seam that was synchronous could never have held one.
    const encrypted = await encryptApiKey(body.apiKey);
    const keyId = await adminRepo.storeAiKey(
      user.userId,
      configId,
      encrypted.keyPrefix,
      encrypted.keyLast4,
      encrypted.ciphertext,
      encrypted.wrappedDek,
      encrypted.kmsKeyId,
    );
    return { keyId, keyPrefix: encrypted.keyPrefix, keyLast4: encrypted.keyLast4 };
  }

  @Post('keys/:keyId/revoke')
  @ApiOperation({ summary: 'Revoke a stored key' })
  async revokeKey(
    @CurrentUser() user: AuthUser,
    @Param('keyId') keyId: string,
    @ValidBody(RevokeAiKeyDto) body: RevokeAiKeyDto,
  ): Promise<{ revoked: true }> {
    await adminRepo.revokeAiKey(user.userId, keyId, body.reason);
    return { revoked: true };
  }

  @Get('usage')
  @ApiOperation({ summary: 'Extraction runs, cost and latency by engine/model, last 30 days' })
  async usage(@CurrentUser() user: AuthUser): Promise<AdminAiUsageStat[]> {
    return adminRepo.getAiUsageSummary(user.userId);
  }
}
