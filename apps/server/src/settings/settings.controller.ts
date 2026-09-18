import {
  BadRequestException,
  Body,
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
import type {
  BusinessSettings,
  TaxPackFile,
  CategorySetting,
  Connection,
  PlanUsage,
  TaxPack,
} from '@snap/api-contract';
import { OCCUPATION_GROUPS, PROFILES } from '@snap/tax-engine';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { readPlan, readTenant, updateTenant } from '../repo.js';
import { abnIsValid } from '../extraction/validators.js';
import {
  createCategory,
  deleteCategory,
  listCategories,
  listConnections,
  readTaxPack,
  revokeConnection,
  setCategoryActive,
} from './settings.repo.js';
import { assembleTaxPack } from '../export/pack.js';
import { issueDownloadToken } from '../tokens.js';
import { config } from '../config.js';

export class BusinessSettingsDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() abn?: string | null;
  @IsOptional() @IsBoolean() gstRegistered?: boolean;
  @IsOptional() @IsIn(['cash', 'accrual']) gstBasis?: 'cash' | 'accrual';
  @IsOptional() @IsBoolean() simplerBas?: boolean;
  @IsOptional() @IsString() occupationProfileId?: string | null;
}

export class CategoryActiveDto {
  @IsBoolean() active!: boolean;
}

export class NewCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() taxLabel?: string | null;
}

/**
 * Settings, the plan, connections, and what an export would contain.
 *
 * Every figure a user might act on is read from the database on request. The
 * plan in particular: a seat count and a seat limit read a moment apart can
 * say "6 of 5", and the one place that matters is the screen where somebody
 * decides whether to pay for more.
 */
@ApiTags('settings')
@Controller('v1')
@UseGuards(SessionGuard, MembershipGuard)
export class SettingsController {
  @Get('settings/business')
  @ApiOperation({ summary: 'What this workspace is, for tax purposes' })
  async business(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<BusinessSettings> {
    const tenant = await readTenant(user.userId, tenantId);
    if (!tenant) throw new NotFoundException('No such workspace.');
    return {
      workspaceId: tenant.id,
      name: tenant.name,
      abn: tenant.abn,
      // Computed by the database from the ATO checksum, not stored by us.
      abnValid: tenant.abn_valid === true,
      gstRegistered: tenant.gst_registered,
      gstBasis: tenant.gst_basis,
      simplerBas: tenant.simpler_bas,
      occupationProfileId: tenant.occupation_profile_id,
      occupationLabel: tenant.occupation_profile_id
        ? (PROFILES[tenant.occupation_profile_id]?.label ?? null)
        : null,
      financialYearStartMonth: tenant.financial_year_start_month,
    };
  }

  @Patch('settings/business')
  @ApiOperation({
    summary: 'Change them',
    description:
      'An ABN is checksummed before it is stored. A personal workspace cannot hold one at all — the database refuses it, and so does this.',
  })
  async updateBusiness(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(BusinessSettingsDto) body: BusinessSettingsDto,
  ): Promise<BusinessSettings> {
    const tenant = await readTenant(user.userId, tenantId);
    if (!tenant) throw new NotFoundException('No such workspace.');

    let abn: string | null | undefined;
    if (body.abn !== undefined) {
      const digits = (body.abn ?? '').replace(/\D/g, '');
      if (digits === '') {
        abn = null;
      } else {
        // Checked here rather than left to the database, so the message says
        // what is wrong with the number instead of naming a constraint.
        if (!abnIsValid(digits)) {
          throw new BadRequestException(
            'That ABN fails the ATO checksum — it is not a real ABN. Check for a transposed digit.',
          );
        }
        if (tenant.kind === 'personal') {
          throw new BadRequestException('A personal workspace does not have an ABN.');
        }
        abn = digits;
      }
    }

    if (body.gstRegistered === true && tenant.kind === 'personal') {
      throw new BadRequestException('A household is not registered for GST.');
    }
    if (
      body.occupationProfileId != null &&
      body.occupationProfileId !== '' &&
      !PROFILES[body.occupationProfileId]
    ) {
      throw new BadRequestException(
        `Unknown occupation. Expected one of: ${Object.keys(PROFILES).join(', ')}.`,
      );
    }

    await updateTenant(user.userId, tenantId, {
      name: body.name,
      ...(abn !== undefined ? { abn } : {}),
      gstRegistered: body.gstRegistered,
      gstBasis: body.gstBasis,
      simplerBas: body.simplerBas,
      ...(body.occupationProfileId !== undefined
        ? { occupationProfileId: body.occupationProfileId || null }
        : {}),
    });
    return this.business(user, tenantId);
  }

  @Get('settings/occupations')
  @ApiOperation({
    summary: 'The occupations an account can choose',
    description:
      'Served rather than shipped in the app, so a rate year that adds a profile does not need a store release.',
  })
  occupations(): Array<{ group: string; profiles: Array<{ id: string; label: string }> }> {
    return OCCUPATION_GROUPS.map((g) => ({
      group: g.label,
      // '--' is a spacer in the source data, and a group can name a profile
      // that has no worksheet of its own (FIFO maps onto a base profile), so
      // both are filtered rather than rendered as an empty row.
      profiles: g.ids
        .filter((id: string) => PROFILES[id] !== undefined)
        .map((id: string) => ({ id, label: PROFILES[id]!.label })),
    }));
  }

  @Get('settings/categories')
  @ApiOperation({ summary: 'Categories, with what has been spent against each' })
  async categories(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<CategorySetting[]> {
    const rows = await listCategories(user.userId, tenantId);
    return rows.map((r) => ({
      name: r.name,
      taxLabel: r.tax_label,
      monthlyBudget: r.monthly_budget,
      documentCount: r.document_count,
      totalSpend: r.total_spend,
      active: r.active,
      deletable: r.deletable,
    }));
  }

  @Post('settings/categories')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a category' })
  async addCategory(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(NewCategoryDto) body: NewCategoryDto,
  ): Promise<CategorySetting[]> {
    const name = body.name.trim();
    if (name === '') throw new BadRequestException('A category needs a name.');
    await createCategory(user.userId, tenantId, name, body.taxLabel?.trim() || null);
    return this.categories(user, tenantId);
  }

  @Patch('settings/categories/:name')
  @ApiOperation({
    summary: 'Retire or restore a category',
    description:
      'Retiring stops it being offered for new documents and changes nothing about the ones that already carry it. Categories are never deleted: they are referenced by records with a five-year retention obligation.',
  })
  async toggleCategory(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('name') name: string,
    @ValidBody(CategoryActiveDto) body: CategoryActiveDto,
  ): Promise<CategorySetting[]> {
    const found = await setCategoryActive(user.userId, tenantId, name, body.active);
    if (!found) throw new NotFoundException(`No category called ${name}.`);
    return this.categories(user, tenantId);
  }

  @Delete('settings/categories/:name')
  @ApiOperation({
    summary: 'Delete a category that nothing uses',
    description:
      'Refused whenever anything points at the category — a receipt line, a ledger entry, a subcategory, or a budget — because deleting it would either fail a foreign key or, for a budget, silently orphan one. A category with any history should be switched off instead: same effect on new receipts, none of the risk to old ones.',
  })
  async removeCategory(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('name') name: string,
  ): Promise<CategorySetting[]> {
    const result = await deleteCategory(user.userId, tenantId, name);
    if (result.outcome === 'not_found') throw new NotFoundException(`No category called ${name}.`);
    if (result.outcome === 'in_use') {
      throw new ConflictException(
        `"${name}" cannot be deleted — it has ${joinWithAnd(result.reasons)}. Switch it off instead.`,
      );
    }
    return this.categories(user, tenantId);
  }

  @Get('plan')
  @ApiOperation({ summary: 'The plan, and how much of it is left' })
  async plan(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<PlanUsage> {
    const p = await readPlan(user.userId, tenantId);
    return {
      planCode: p.plan_code,
      planName: p.plan_name,
      priceCents: p.price_cents,
      realtime: p.realtime,
      scanQuota: p.scan_quota,
      scansUsed: p.scans_used,
      // null means unmetered, and must stay null. Any sentinel large number
      // would eventually be counted down to zero and lock someone out.
      scansRemaining:
        p.scan_quota === null
          ? null
          : Math.max(0, p.scan_quota - p.scans_used) + p.topup_remaining,
      seatLimit: p.seat_limit,
      seatsUsed: p.seats_used,
      retentionMonths: p.retention_months,
      periodEnds: p.period_ends.slice(0, 10),
      firmName: p.firm_name,
    };
  }

  @Get('connections')
  @ApiOperation({
    summary: 'Accounting software this workspace is linked to',
    description:
      'The three providers are always listed, connected or not: the point of the screen is to offer the ones that are not.',
  })
  async connections(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<Connection[]> {
    const { connections, queued } = await listConnections(user.userId, tenantId);
    return PROVIDERS.map((c) => {
      const live = connections.find((row) => row.provider === c.id);
      return {
        id: c.id,
        name: c.name,
        status: live ? ('connected' as const) : ('disconnected' as const),
        lastSyncAt: live?.connected_at ?? null,
        // Nothing is queued for a provider that is not connected: a queue
        // implies something is going to happen, and nothing is.
        queued: live ? queued : 0,
        organisation: live?.external_tenant_id ?? null,
        note: c.note,
      };
    });
  }

  @Post('connections/:id/connect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Begin linking accounting software',
    description:
      'Returns the URL to open in a browser. It does NOT return a connected state: the app cannot know whether the user completed the consent screen, and saying "connected" before they have promises a sync that will never run. The connection appears in GET /v1/connections once the callback lands.',
  })
  async connect(
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<{ authorizeUrl: string }> {
    const provider = PROVIDERS.find((p) => p.id === id);
    if (!provider) throw new NotFoundException(`No such provider: ${id}.`);

    const clientId = process.env[`${provider.id.toUpperCase()}_CLIENT_ID`];
    if (!clientId) {
      // Refused rather than faked. A stub that reports a connection produces a
      // screen claiming receipts are flowing into Xero when nothing is.
      throw new BadRequestException(
        `${provider.name} is not configured on this server: ${provider.id.toUpperCase()}_CLIENT_ID is unset. ` +
          'OAuth cannot be started without it.',
      );
    }

    // `state` binds the round trip to this workspace and expires, so a
    // callback cannot be replayed into a different one.
    const state = issueDownloadToken(`oauth:${provider.id}`, tenantId);
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', `${config().PUBLIC_URL}/v1/connections/${provider.id}/callback`);
    url.searchParams.set('scope', provider.scopes);
    url.searchParams.set('state', state);
    return { authorizeUrl: url.toString() };
  }

  @Post('connections/:id/disconnect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unlink accounting software',
    description:
      'Marked revoked, not deleted: "we never had one" and "we disconnected in March" are different answers to an accountant.',
  })
  async disconnect(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<Connection[]> {
    if (!PROVIDERS.some((p) => p.id === id)) {
      throw new NotFoundException(`No such provider: ${id}.`);
    }
    await revokeConnection(user.userId, tenantId, id);
    return this.connections(user, tenantId);
  }

  @Post('tax-pack')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Assemble the pack',
    description:
      'Zips the original images exactly as captured, with an index and a trip log. Separate from GET, which only describes what a pack would hold — describing is instant, assembling is a job over a financial year of photographs.',
  })
  async prepareTaxPack(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<TaxPackFile> {
    const { fromDate, toDate, periodLabel } = financialYear();
    const pack = await assembleTaxPack(user.userId, tenantId, fromDate, toDate, periodLabel);
    const token = issueDownloadToken(pack.key, tenantId);
    return {
      url: `/v1/downloads/${token}`,
      filename: pack.filename,
      bytes: pack.bytes,
      documentCount: pack.documentCount,
      // Matches the token's own lifetime, so the UI can say when the link
      // stops working instead of letting it 404 in the user's hand.
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }

  @Get('tax-pack')
  @ApiOperation({
    summary: 'What an export would contain',
    description:
      'Measured, not estimated: the byte counts are the real stored sizes of the original captures. Covers the current Australian financial year, which starts on 1 July.',
  })
  async taxPack(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<TaxPack> {
    const { fromDate, toDate, periodLabel } = financialYear();
    const sections = await readTaxPack(user.userId, tenantId, fromDate, toDate);
    return {
      periodLabel,
      fromDate,
      toDate,
      sections: sections.map((s) => ({ ...s, included: s.count > 0 })),
      totalBytes: sections.reduce((a, s) => a + s.bytes, 0),
      retentionNote:
        'Business records must be kept for five years from the date they were prepared, obtained or the transaction completed — whichever is latest.',
    };
  }
}

/** "a" | "a and b" | "a, b and c" — for naming every blocking reason at once. */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ── The providers this server knows how to talk to ──────────────────────── */

/**
 * One list, used both to render the settings screen and to start an OAuth
 * round trip. Two lists would eventually disagree, and the way that shows up
 * is a provider a user can see and cannot connect.
 *
 * The authorise URLs and scopes are each vendor's published values. No client
 * id is here: that is deployment configuration, and its absence is why
 * `connect` refuses rather than pretending.
 */
const PROVIDERS: Array<{
  id: Connection['id'];
  name: string;
  note: string;
  authorizeUrl: string;
  scopes: string;
}> = [
  {
    id: 'xero',
    name: 'Xero',
    note: 'Pushes each confirmed bill with its GST already worked out, and attaches the original image.',
    authorizeUrl: 'https://login.xero.com/identity/connect/authorize',
    scopes: 'offline_access accounting.transactions accounting.attachments accounting.settings',
  },
  {
    id: 'myob',
    name: 'MYOB',
    note: 'Pushes confirmed bills. Attachments are not supported by the MYOB API, so the original stays here.',
    authorizeUrl: 'https://secure.myob.com/oauth2/account/authorize',
    scopes: 'CompanyFile',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    note: 'Pushes confirmed bills with the original attached.',
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    scopes: 'com.intuit.quickbooks.accounting',
  },
];

/**
 * The current Australian financial year: 1 July to 30 June.
 *
 * In one place because every export and every BAS period depends on it, and a
 * calendar year computed by accident silently covers the wrong twelve months.
 */
function financialYear(now = new Date()): {
  fromDate: string;
  toDate: string;
  periodLabel: string;
} {
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    fromDate: `${startYear}-07-01`,
    toDate: `${startYear + 1}-06-30`,
    periodLabel: `FY${String(startYear + 1).slice(2)} (1 Jul ${startYear} – 30 Jun ${startYear + 1})`,
  };
}
