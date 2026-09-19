import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NoRulesInstalled, RulesRejected } from '@snap/tax-rules';
import { IsString, Matches } from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { readTenant } from '../repo.js';
import {
  availableRules,
  consumptionTaxReport,
  installRulesFor,
  rulesFor,
  type AvailableRules,
  type ConsumptionTaxReport,
} from './taxrules.repo.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The catalogue of installable tax engines.
 *
 * A SEPARATE controller because it is not workspace-scoped, and the reason is
 * concrete: onboarding has to offer a country BEFORE a workspace exists, so a
 * `MembershipGuard` on this route would make the first screen unreachable.
 *
 * This is the same shape the database already uses for `plans` and system
 * `tax_codes` — catalogue data, readable by anyone signed in, writable by
 * nobody but a migration. It exposes no tenant data at all: rule-set ids,
 * country names, versions and currency codes.
 */
@ApiTags('tax-rules')
@Controller('v1/tax-rules-catalogue')
/* DELIBERATELY UNGUARDED.
 *
 * It carried `SessionGuard` until 2026-09-19, on the reasoning above that
 * onboarding runs before a WORKSPACE exists. That was half the problem: the
 * mobile client asks which country you are in on the REGISTRATION screen,
 * which runs before a SESSION exists, so the guard returned 401 and the
 * country list was always empty.
 *
 * Nothing here is tenant data — rule-set ids, country names, versions, tax
 * years, scope and currency codes, all of it fixed by migration and identical
 * for every caller. It is the same class of public catalogue as a pricing
 * page. There is no user input, no per-caller variation and nothing to
 * enumerate, so an unauthenticated read gives an attacker nothing they could
 * not read in the repository.
 */
export class TaxRulesCatalogueController {
  @Get()
  @ApiOperation({
    summary: 'Tax engines this deployment can install',
    description:
      'Not workspace-scoped: onboarding needs it before a workspace exists. Catalogue data only — no tenant information passes through here.',
  })
  available(): AvailableRules[] {
    return availableRules();
  }
}

export class InstallRulesDto {
  @IsString()
  @Matches(/^[a-z]{2}-\d{4}$/, {
    message: 'rulesId must look like "id-2026" — a lowercase country code and a tax year.',
  })
  rulesId!: string;
}

export type InstalledRulesView = {
  /** NULL when no engine is installed. Every tax figure then refuses. */
  rulesId: string | null;
  rulesVersion: string | null;
  country: string;
  countryName: string | null;
  taxYear: string | null;
  consumptionTaxName: string | null;
  currency: string;
  /** What the annual return is called locally, e.g. 'SPT Tahunan'. */
  annualReturnName: string | null;
  /** 'none' for a taxpayer with no filing obligation for the consumption tax. */
  filingPeriod: string | null;
  /** True when the taxpayer can recover consumption tax. False for personal. */
  recoverable: boolean | null;
  /** Present when the engine refuses. The reason, for the user, not a log. */
  problem: string | null;
  available: AvailableRules[];
};

/**
 * The installed tax engine, and what it says about this workspace's spending.
 *
 * Two surfaces, and the second one is the reason the first exists. Nothing here
 * computes tax itself: every number comes from `@snap/tax-rules`, and a
 * workspace with no rule set installed gets a refusal rather than a default.
 *
 * `docs/INDONESIA.md` §8 is the inventory of what is still hardcoded to
 * Australia elsewhere in this server. This controller is the first surface that
 * reads `tenants.country` and acts on it.
 */
@ApiTags('tax-rules')
@Controller('v1/tax-rules')
@UseGuards(SessionGuard, MembershipGuard)
export class TaxRulesController {
  @Get()
  @ApiOperation({
    summary: 'Which tax engine this workspace is running',
    description:
      'Returns the installed rule set, or nulls with a `problem` when none is installed. There is deliberately no default — a workspace with no engine refuses every tax calculation rather than falling back to Australian rules, because plausible numbers computed under the wrong law look exactly like correct ones.',
  })
  async installed(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<InstalledRulesView> {
    const tenant = await readTenant(user.userId, tenantId);
    if (!tenant) throw new BadRequestException('No such workspace.');

    const base = {
      country: tenant.country,
      currency: tenant.base_currency,
      available: availableRules(),
    };

    try {
      const rules = await rulesFor(tenant);
      return {
        ...base,
        rulesId: rules.id,
        rulesVersion: rules.version,
        countryName: rules.countryName,
        taxYear: rules.taxYear,
        consumptionTaxName: rules.consumptionTax.name,
        annualReturnName: rules.periods.annualReturnName,
        filingPeriod: rules.periods.consumptionTaxPeriod,
        recoverable: rules.consumptionTax.recoverable,
        problem: null,
      };
    } catch (e) {
      // A refusal is a state to render, not a 500. The settings screen needs
      // to show "no engine installed" and offer the list to install from.
      if (e instanceof NoRulesInstalled || e instanceof RulesRejected) {
        return {
          ...base,
          rulesId: tenant.tax_rules_id,
          rulesVersion: tenant.tax_rules_version,
          countryName: null,
          taxYear: null,
          consumptionTaxName: null,
          annualReturnName: null,
          filingPeriod: null,
          recoverable: null,
          problem: e.message,
        };
      }
      throw e;
    }
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Install a tax engine, replacing whatever is installed',
    description:
      'One engine at a time. Installing replaces — there is no merge and no inheritance, because a half-applied jurisdiction is worse than a refused one. The workspace\'s country, base currency and financial-year start move WITH the engine, so it cannot end up Indonesian for tax and Australian for its year.',
  })
  async install(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(InstallRulesDto) body: InstallRulesDto,
  ): Promise<InstalledRulesView> {
    const tenant = await readTenant(user.userId, tenantId);
    if (!tenant) throw new BadRequestException('No such workspace.');

    try {
      await installRulesFor(user.userId, tenantId, body.rulesId);
    } catch (e) {
      if (e instanceof RulesRejected || e instanceof NoRulesInstalled) {
        // 422, not 500: the request was well-formed and the engine refused it.
        // The message names what is wrong with the rule set, which is what a
        // person can act on.
        throw new UnprocessableEntityException(e.message);
      }
      throw e;
    }
    return this.installed(user, tenantId);
  }

  @Get('consumption-tax')
  @ApiOperation({
    summary: 'Consumption tax over a period, from the ledger',
    description:
      'Sums POSTED splits by tax code. For a taxpayer who cannot recover the tax this is a SPENDING ANALYTIC and says so in `disclosure` — it is not a return, and `filingPeriod` is "none". Tax belonging to a different levy (Indonesia\'s PB1, a regional tax that prints like PPN and is never recoverable) is reported separately in `otherTaxPaid` and never folded into `taxPaid`.',
  })
  async consumptionTax(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ConsumptionTaxReport> {
    if (!from || !DATE_RE.test(from)) {
      throw new BadRequestException('from must be a YYYY-MM-DD date.');
    }
    if (!to || !DATE_RE.test(to)) {
      throw new BadRequestException('to must be a YYYY-MM-DD date.');
    }
    if (from > to) {
      throw new BadRequestException('from must not be after to.');
    }

    try {
      return await consumptionTaxReport(user.userId, tenantId, from, to);
    } catch (e) {
      if (e instanceof NoRulesInstalled || e instanceof RulesRejected) {
        // The refusal reaches the user intact. Returning zeros here would be
        // the worst possible answer: a confident nothing, indistinguishable
        // from a workspace that genuinely spent nothing.
        throw new UnprocessableEntityException(e.message);
      }
      throw e;
    }
  }
}
