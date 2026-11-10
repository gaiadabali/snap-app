import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { GstReport, InvoiceIssuerProposalRequest, InvoiceIssuerState } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { buildGstReport, resolveRange } from '../credits/gst-report.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvoiceIssuerProposalDto implements InvoiceIssuerProposalRequest {
  @IsString() @Length(1, 200) legalName!: string;
  @IsOptional() @IsString() @MaxLength(20) abn?: string | null;
  @IsString() @Length(1, 500) address!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsBoolean() gstRegistered!: boolean;
  @IsString() @Length(1, 500) reason!: string;
}

/**
 * Who issues credit receipts and tax invoices (7.7.a). A change is PROPOSED by
 * one admin and has to be APPROVED by a different one; the database refuses a
 * self-approval whatever this layer does (migration 0059).
 */
@ApiTags('admin')
@Controller('v1/admin/invoicing/issuer')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_platform_settings')
export class AdminInvoiceIssuerController {
  @Get()
  @ApiOperation({ summary: 'The invoice issuer in force, any change waiting for approval, and the history' })
  async state(@CurrentUser() user: AuthUser): Promise<InvoiceIssuerState> {
    return adminRepo.getInvoiceIssuerState(user.userId);
  }

  @Post('proposals')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Propose a new issuer (legal name, ABN, address, email, GST registered)',
    description:
      'Takes effect only when a different admin approves it. The ABN is checked with the ATO check digits; GST registered needs a valid ABN. One proposal can wait at a time.',
  })
  async propose(
    @CurrentUser() user: AuthUser,
    @ValidBody(InvoiceIssuerProposalDto) body: InvoiceIssuerProposalDto,
  ): Promise<InvoiceIssuerState> {
    await adminRepo.proposeInvoiceIssuer(user.userId, body);
    return adminRepo.getInvoiceIssuerState(user.userId);
  }

  @Post('proposals/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a proposal. 403 for the admin who proposed it.' })
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InvoiceIssuerState> {
    if (!UUID.test(id)) throw new NotFoundException('No such change.');
    await adminRepo.decideInvoiceIssuer(user.userId, id, true);
    return adminRepo.getInvoiceIssuerState(user.userId);
  }

  @Post('proposals/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a proposal (the admin who proposed it may withdraw it this way)' })
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InvoiceIssuerState> {
    if (!UUID.test(id)) throw new NotFoundException('No such change.');
    await adminRepo.decideInvoiceIssuer(user.userId, id, false);
    return adminRepo.getInvoiceIssuerState(user.userId);
  }
}

/** The quarterly GST export (6.12.b). */
@ApiTags('admin')
@Controller('v1/admin/invoicing/gst-report')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('manage_billing')
export class AdminGstReportController {
  @Get()
  @ApiOperation({
    summary: 'GST report as CSV for an Australian quarter or a date range',
    description:
      'Give quarter=FY2026-Q2 (Oct-Dec 2025; the financial year ends 30 June) or from=YYYY-MM-DD&to=YYYY-MM-DD, Sydney dates. Documents issued in the range, a totals block (sales, GST collected, refunds), and Google Play sales in a separate section marked "GST paid by Google".',
  })
  async report(
    @CurrentUser() user: AuthUser,
    @Query('quarter') quarter?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<GstReport> {
    const range = resolveRange({ quarter, from, to });
    if (!range) {
      throw new BadRequestException('Give quarter=FY2026-Q2, or from and to as YYYY-MM-DD with from on or before to.');
    }
    const rows = await adminRepo.getGstReportRows(user.userId, range.from, range.to);
    return buildGstReport(range, rows, new Date());
  }
}
