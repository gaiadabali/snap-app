import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import * as repo from './business.repo.js';

const DECIMAL = /^\d+(\.\d{1,4})?$/;

/* ── DTOs ────────────────────────────────────────────────────────────────── */

export class RecordPaymentDto {
  @IsString() invoiceId!: string;
  @Matches(DECIMAL, { message: 'amount must be a positive decimal.' }) amount!: string;
  @IsIn(['bank', 'card', 'cash', 'other']) method!: 'bank' | 'card' | 'cash' | 'other';
  @IsOptional() @IsString() reference?: string;
}

export class PayBillDto {
  @IsOptional() @Matches(DECIMAL) amount?: string;
}

export class CreateItemDto {
  @IsString() name!: string;
  @IsOptional() @IsString() sku?: string;
  @IsString() unit!: string;
  @Matches(DECIMAL) sellPrice!: string;
  @Matches(DECIMAL) costPrice!: string;
  /** null for a service, which is not the same as none in stock. */
  @IsOptional() @IsNumber() @Min(0) stockOnHand?: number | null;
  @IsOptional() @IsString() taxCode?: string;
}

export class CountStockDto {
  @IsNumber() @Min(0) countedQuantity!: number;
}

export class AddTripDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() fromPlace!: string;
  @IsString() toPlace!: string;
  @IsNumber() @Min(0.1) km!: number;
  @IsOptional() @IsString() purpose?: string;
  @IsBoolean() workRelated!: boolean;
  @IsOptional() @IsIn(['gps', 'manual']) source?: 'gps' | 'manual';
}

export class SetBudgetDto {
  @IsString() category!: string;
  @Matches(DECIMAL) monthly!: string;
}

export class CreateGoalDto {
  @IsString() name!: string;
  @Matches(DECIMAL) target!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) targetDate?: string;
}

export class ContributeDto {
  @Matches(DECIMAL) amount!: string;
  /** When the money actually went in. Defaults to today when omitted. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) occurredOn?: string;
}

export class GroundContributionDto {
  @IsString() statementLineId!: string;
  /** Optional: defaults to the whole line server-side. Never a larger figure than the line. */
  @IsOptional() @Matches(DECIMAL) amount?: string;
  /**
   * Accepted, never used. docs/STATEMENTS.md §12 R5f-2: a grounded
   * contribution's date comes from the bank (`statement_lines.posted_date`),
   * never from what a person remembers — declared here only so a client
   * sending the same shape as `ContributeDto` is not rejected outright by
   * `ValidBody`'s `forbidNonWhitelisted`.
   */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) occurredOn?: string;
}

export class CreatePartyDto {
  @IsString() name!: string;
  @IsIn(['customer', 'supplier']) kind!: 'customer' | 'supplier';
  @IsOptional() @IsString() abn?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

/**
 * Everything that is not a receipt.
 *
 * Money in (invoices, payments), money out (bills), what you sell (items,
 * stock), the logbook, and the personal side (budgets, goals). Grouped in one
 * controller because they share a shape — list, create, act — and splitting
 * them into eight files of six lines each would obscure that.
 *
 * Every figure that could be either stored or derived is DERIVED: what is owed
 * on an invoice comes from its payments, not from a balance column. Two
 * sources for one fact diverge the first time someone voids a payment.
 */
@ApiTags('business')
@Controller('v1')
@UseGuards(SessionGuard, MembershipGuard)
export class BusinessController {
  /* ── Invoices ─────────────────────────────────────────────────────────── */

  @Get('invoices')
  @ApiOperation({ summary: 'Invoices and estimates, with what is owed on each' })
  async invoices(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('kind') kind?: string,
  ) {
    const chosen = kind === 'invoice' || kind === 'estimate' ? kind : undefined;
    return (await repo.listInvoices(user.userId, tenantId, chosen)).map(toInvoice);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'One invoice, with its lines' })
  async invoice(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    const found = await repo.getInvoice(user.userId, tenantId, id);
    if (!found) throw new NotFoundException('No such invoice.');
    return { ...toInvoice(found.invoice), lines: found.lines.map(toInvoiceLine) };
  }

  @Post('invoices/:id/convert')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Copy an accepted estimate into a draft invoice',
    description:
      'A copy, not a conversion in place: the estimate stays on file as what the customer agreed to. GST is recomputed rather than copied.',
  })
  async convert(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    const outcome = await repo.convertEstimate(user.userId, tenantId, id);
    if ('error' in outcome) {
      if (outcome.error === 'not_found') throw new NotFoundException('No such estimate.');
      throw new BadRequestException(
        outcome.error === 'not_an_estimate'
          ? 'That is already an invoice.'
          : 'This estimate has already been invoiced.',
      );
    }
    const made = await repo.getInvoice(user.userId, tenantId, outcome.id);
    return { ...toInvoice(made!.invoice), lines: made!.lines.map(toInvoiceLine) };
  }

  /* ── Payments ─────────────────────────────────────────────────────────── */

  @Get('payments')
  @ApiOperation({ summary: 'Money received' })
  async payments(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listPayments(user.userId, tenantId)).map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoice_number,
      partyName: p.party_name,
      date: p.paid_on,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
    }));
  }

  @Post('payments')
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  async recordPayment(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(RecordPaymentDto) body: RecordPaymentDto,
  ) {
    const outcome = await repo.recordPayment(
      user.userId,
      tenantId,
      body.invoiceId,
      body.amount,
      body.method,
      body.reference,
    );
    if ('error' in outcome) {
      if (outcome.error === 'not_found') throw new NotFoundException('No such invoice.');
      throw new BadRequestException(
        `That is more than the $${Number(outcome.due ?? 0).toFixed(2)} still owing.`,
      );
    }
    return { id: outcome.id };
  }

  /* ── Bills ────────────────────────────────────────────────────────────── */

  @Get('bills')
  @ApiOperation({ summary: 'Money owed to suppliers, by due date' })
  async bills(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listBills(user.userId, tenantId)).map((b) => ({
      id: b.id,
      supplierName: b.supplier_name ?? 'Unknown supplier',
      reference: b.reference ?? '',
      issueDate: b.issue_date,
      dueDate: b.due_date,
      totalAmount: b.total_amount,
      gstAmount: b.gst_amount,
      amountPaid: b.amount_paid,
      amountDue: b.amount_due,
      status: b.status,
      category: b.category ?? 'Uncategorised',
    }));
  }

  @Post('bills/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pay a bill, in full or in part' })
  async payBill(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(PayBillDto) body: PayBillDto,
  ) {
    const outcome = await repo.payBill(user.userId, tenantId, id, body.amount);
    if ('error' in outcome) {
      if (outcome.error === 'not_found') throw new NotFoundException('No such bill.');
      throw new BadRequestException(
        `That is more than the $${Number(outcome.due ?? 0).toFixed(2)} still owing.`,
      );
    }
    return { paid: true };
  }

  /* ── Items and stock ──────────────────────────────────────────────────── */

  @Get('items')
  @ApiOperation({ summary: 'Products and services you sell' })
  async items(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listItems(user.userId, tenantId)).map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku ?? '',
      unit: i.unit,
      sellPrice: i.sell_price,
      costPrice: i.cost_price,
      stockOnHand: i.stock_on_hand === null ? null : Number(i.stock_on_hand),
      lowStock: i.low_stock,
      taxCode: i.tax_code,
    }));
  }

  @Post('items')
  @ApiOperation({ summary: 'Add an item' })
  async createItem(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(CreateItemDto) body: CreateItemDto,
  ) {
    const outcome = await repo.createItem(user.userId, tenantId, {
      name: body.name,
      sku: body.sku ?? null,
      unit: body.unit,
      sellPrice: body.sellPrice,
      costPrice: body.costPrice,
      stockOnHand: body.stockOnHand ?? null,
      taxCode: body.taxCode ?? 'GSTONINCOME',
    });
    if ('error' in outcome) {
      throw new BadRequestException(`SKU ${body.sku} is already used by another item.`);
    }
    return { id: outcome.id };
  }

  @Get('stock-movements')
  @ApiOperation({ summary: 'Why the stock count is what it is' })
  async movements(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listStockMovements(user.userId, tenantId)).map((m) => ({
      id: m.id,
      itemId: m.item_id,
      itemName: m.item_name,
      kind: m.kind,
      quantity: Number(m.quantity),
      at: m.at,
      note: m.note,
      byName: m.by_name,
    }));
  }

  @Post('items/:id/count')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a stock take',
    description:
      'Written as a movement carrying the difference. Overwriting the number would discard what a stock take exists to produce: how far out the records were.',
  })
  async count(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(CountStockDto) body: CountStockDto,
  ) {
    const outcome = await repo.countStock(user.userId, tenantId, id, body.countedQuantity);
    if ('error' in outcome) {
      if (outcome.error === 'not_found') throw new NotFoundException('No such item.');
      throw new BadRequestException('That is a service — it has no stock.');
    }
    return { difference: outcome.difference };
  }

  /* ── Trips ────────────────────────────────────────────────────────────── */

  @Get('trips')
  @ApiOperation({ summary: 'The logbook behind a D1 claim' })
  async trips(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listTrips(user.userId, tenantId)).map((t) => ({
      id: t.id,
      date: t.trip_date,
      fromPlace: t.from_place,
      toPlace: t.to_place,
      km: Number(t.km),
      purpose: t.purpose ?? 'Work travel',
      workRelated: t.work_related,
      source: t.source,
    }));
  }

  @Post('trips')
  @ApiOperation({ summary: 'Log a trip' })
  async addTrip(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(AddTripDto) body: AddTripDto,
  ) {
    return repo.addTrip(user.userId, tenantId, {
      date: body.date,
      fromPlace: body.fromPlace,
      toPlace: body.toPlace,
      km: body.km,
      purpose: body.purpose ?? 'Work travel',
      workRelated: body.workRelated,
      source: body.source ?? 'manual',
    });
  }

  @Delete('trips/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a trip' })
  async deleteTrip(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    await repo.deleteTrip(user.userId, tenantId, id);
    return { deleted: true };
  }

  /* ── Budgets and goals ────────────────────────────────────────────────── */

  @Get('budgets')
  @ApiOperation({ summary: 'What each category is allowed per month' })
  async budgets(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return repo.listBudgets(user.userId, tenantId);
  }

  @Put('budgets')
  @ApiOperation({ summary: 'Set a category budget' })
  async setBudget(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(SetBudgetDto) body: SetBudgetDto,
  ) {
    await repo.setBudget(user.userId, tenantId, body.category, body.monthly);
    return { category: body.category, monthly: body.monthly };
  }

  @Get('goals')
  @ApiOperation({ summary: 'Savings goals' })
  async goals(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string) {
    return (await repo.listGoals(user.userId, tenantId)).map(toGoal);
  }

  @Post('goals')
  @ApiOperation({ summary: 'Start a goal' })
  async createGoal(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(CreateGoalDto) body: CreateGoalDto,
  ) {
    return repo.createGoal(
      user.userId,
      tenantId,
      body.name,
      body.target,
      body.targetDate ?? null,
    );
  }

  @Get('goals/:id/contributions')
  @ApiOperation({ summary: "A goal's contributions, newest first — the evidence behind `saved`" })
  async goalContributions(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    return (await repo.listGoalContributions(user.userId, tenantId, id)).map(toGoalContribution);
  }

  @Post('goals/:id/contribute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add to a goal — recorded as a contribution, not a bare increment' })
  async contribute(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(ContributeDto) body: ContributeDto,
  ) {
    const contribution = await repo.addGoalContribution(
      user.userId,
      tenantId,
      id,
      body.amount,
      body.occurredOn ?? null,
    );
    return {
      contribution: toGoalContribution(contribution),
      goals: (await repo.listGoals(user.userId, tenantId)).map(toGoal),
    };
  }

  @Post('business/goals/:id/contributions')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Ground a contribution in an observed bank movement',
    description:
      "The client supplies only statementLineId and, optionally, a smaller amount — the server derives amount (default: the whole line), occurredOn (the line's own posted_date) and source. A body-supplied occurredOn is ignored: the date comes from the bank, not from what a person remembers. docs/STATEMENTS.md §12 R5f-2.",
  })
  async groundContribution(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(GroundContributionDto) body: GroundContributionDto,
  ) {
    const outcome = await repo.addGroundedGoalContribution(
      user.userId,
      tenantId,
      id,
      body.statementLineId,
      body.amount ?? null,
    );
    if (!outcome.ok) {
      switch (outcome.reason) {
        case 'line_not_found':
          throw new NotFoundException('No such statement line.');
        case 'not_money_in':
          throw new UnprocessableEntityException(
            `That line is money out (-$${Math.abs(Number(outcome.lineAmount)).toFixed(2)}) — only money coming in can ground a savings contribution.`,
          );
        case 'exceeds_line':
          throw new UnprocessableEntityException(
            `That is more than the $${Number(outcome.lineAmount).toFixed(2)} on this line ($${Number(outcome.available).toFixed(2)} of it is still unclaimed).`,
          );
      }
    }
    return {
      contribution: toGoalContribution(outcome.contribution),
      goals: (await repo.listGoals(user.userId, tenantId)).map(toGoal),
    };
  }

  @Delete('goals/:id/contributions/:contributionId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a contribution — the total adjusts with it' })
  async removeGoalContribution(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @Param('contributionId') contributionId: string,
  ) {
    await repo.removeGoalContribution(user.userId, tenantId, id, contributionId);
    return { goals: (await repo.listGoals(user.userId, tenantId)).map(toGoal) };
  }

  @Delete('goals/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a goal' })
  async deleteGoal(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    await repo.deleteGoal(user.userId, tenantId, id);
    return { deleted: true };
  }

  /* ── Parties ──────────────────────────────────────────────────────────── */

  @Get('parties')
  @ApiOperation({ summary: 'Customers and suppliers' })
  async parties(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('kind') kind?: string,
  ) {
    const chosen = kind === 'customer' || kind === 'supplier' ? kind : undefined;
    return (await repo.listParties(user.userId, tenantId, chosen)).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind === 'both' ? 'customer' : p.kind,
      abn: p.abn,
      abnValid: p.abn_valid === true,
      email: p.email,
      phone: p.phone,
      openBalance: p.open_balance,
      invoiceCount: p.invoice_count,
    }));
  }

  @Post('parties')
  @ApiOperation({ summary: 'Add a customer or supplier' })
  async createParty(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(CreatePartyDto) body: CreatePartyDto,
  ) {
    const abn = body.abn?.replace(/\D/g, '') || null;
    return repo.createParty(user.userId, tenantId, {
      name: body.name,
      kind: body.kind,
      abn,
      email: body.email ?? null,
      phone: body.phone ?? null,
    });
  }
}

/* ── Wire shapes ─────────────────────────────────────────────────────────── */

function toInvoice(i: repo.InvoiceRow) {
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    status: i.status,
    partyId: i.party_id,
    partyName: i.party_name,
    issueDate: i.issue_date,
    dueDate: i.due_date,
    netAmount: i.net_amount,
    gstAmount: i.gst_amount,
    totalAmount: i.total_amount,
    amountPaid: i.amount_paid,
    amountDue: i.amount_due,
    lines: [] as unknown[],
  };
}

function toInvoiceLine(l: repo.InvoiceLineRow) {
  return {
    lineNumber: l.line_number,
    itemId: l.item_id ?? '',
    description: l.description,
    unit: l.unit,
    quantity: Number(l.quantity),
    unitPrice: l.unit_price,
    netAmount: l.net_amount,
    gstAmount: l.gst_amount,
    totalAmount: l.total_amount,
  };
}

function toGoal(g: { id: string; name: string; target: string; saved: string; target_date: string | null }) {
  const remaining = Math.max(0, Number(g.target) - Number(g.saved));
  const done = Number(g.saved) >= Number(g.target);
  let perMonth: string | null = null;
  if (g.target_date && !done) {
    const now = new Date();
    const then = new Date(`${g.target_date}T00:00:00Z`);
    const months = Math.max(
      1,
      (then.getUTCFullYear() - now.getFullYear()) * 12 + (then.getUTCMonth() - now.getMonth()),
    );
    perMonth = (remaining / months).toFixed(4);
  }
  return {
    id: g.id,
    name: g.name,
    target: g.target,
    saved: g.saved,
    targetDate: g.target_date,
    perMonth,
    done,
  };
}

function toGoalContribution(c: repo.GoalContributionRow) {
  return {
    id: c.id,
    goalId: c.goal_id,
    amount: c.amount,
    occurredOn: c.occurred_on,
    createdAt: c.created_at,
    createdByName: c.created_by_name,
    source: c.source,
    statementLineDescription: c.statement_line_description,
  };
}
