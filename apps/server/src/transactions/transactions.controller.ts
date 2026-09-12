import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { listMembers } from '../repo.js';
import {
  draftTransactionFromDocument,
  draftTransactionFromInvoice,
  listTransactions,
  postTransaction,
  type TransactionRow,
} from './transactions.repo.js';

/**
 * The ledger: draft-from-scan, post, list.
 *
 * `docs/PLAN.md` §5 draws a hard line between two acts that look similar and
 * are not: confirming a document (`DocumentsController#confirm`, which locks
 * fields and marks it reviewed) and posting a transaction (here), which is
 * the one that moves the books. This controller only ever does the second.
 *
 * The database — migration 0006's deferred constraint trigger — is the sole
 * authority on whether a posting balances. Nothing in this file re-derives
 * that verdict; it only translates Postgres's rejection into a response a
 * client can act on.
 */
@ApiTags('transactions')
@Controller()
@UseGuards(SessionGuard, MembershipGuard)
export class TransactionsController {
  @Post('v1/documents/:id/transaction')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Propose a draft transaction from a confirmed document',
    description:
      "Splits come from the document's lines and tax subtotals — never from the request body, which is why this takes no payload. A document that is not auto-accepted or reviewed, or that already carries a live transaction, is refused rather than guessed at.",
  })
  async draft(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') documentId: string,
  ): Promise<{ transactionId: string; status: 'draft' }> {
    // No body: every field of the posting is derived from the document, per
    // `docs/contracts/alpha-gaps.md` Lane L — a client-supplied split would
    // let the caller dictate accounts and GST amounts the server is supposed
    // to be the one deciding.
    const outcome = await draftTransactionFromDocument(user.userId, tenantId, documentId);
    if (outcome.ok) return { transactionId: outcome.transactionId, status: 'draft' };

    switch (outcome.reason) {
      case 'missing':
        throw new NotFoundException('No such document.');
      case 'not_confirmed':
        throw new ConflictException(
          `This document is ${outcome.reviewStatus.replace('_', ' ')}, not confirmed — review it before posting.`,
        );
      case 'already_posted':
        throw new ConflictException(
          `This document already has a ${outcome.status} transaction (${outcome.transactionId}).`,
        );
      case 'ambiguous_tax_categories':
        throw new UnprocessableEntityException(
          'This document mixes tax treatments with no per-category reconciliation on record — cannot split it safely.',
        );
      case 'lines_dont_reconcile':
        throw new UnprocessableEntityException(
          `The lines do not add up to the document total (off by ${outcome.gap}) — correct the document before posting.`,
        );
    }
  }

  @Post('v1/business/invoices/:id/transaction')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Propose a draft transaction from a sent invoice',
    description:
      "Splits come from the invoice's lines — never from the request body, which is why this takes no payload, same as the document side. Revenue and GST payable post as credits, the receivable as a debit. An invoice that is still a draft or void, or that already carries a live transaction, is refused rather than guessed at.",
  })
  async draftSale(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') invoiceId: string,
  ): Promise<{ transactionId: string; status: 'draft' }> {
    const outcome = await draftTransactionFromInvoice(user.userId, tenantId, invoiceId);
    if (outcome.ok) return { transactionId: outcome.transactionId, status: 'draft' };

    switch (outcome.reason) {
      case 'missing':
        throw new NotFoundException('No such invoice.');
      case 'not_sent':
        throw new ConflictException(
          `This invoice is ${outcome.status}, not sent — send it before posting.`,
        );
      case 'already_posted':
        throw new ConflictException(
          `This invoice already has a ${outcome.status} transaction (${outcome.transactionId}).`,
        );
      case 'no_lines':
        throw new UnprocessableEntityException('This invoice has no lines to post.');
      case 'lines_dont_reconcile':
        throw new UnprocessableEntityException(
          `The lines do not add up to the invoice total (off by ${outcome.gap}) — correct the invoice before posting.`,
        );
    }
  }

  @Post('v1/transactions/:id/post')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Draft to posted — the act that moves the books',
    description:
      'An owner or admin action, same rule as confirming a document (`Permissions.canConfirm`). The balance check itself is not here: migration 0006 enforces it at commit, and an unbalanced posting surfaces as a 409 translated from that rejection, not a 500.',
  })
  async post(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') transactionId: string,
  ): Promise<{ transactionId: string; status: 'posted' }> {
    // Rule 4: staff may capture, not post. The same role machinery
    // `DocumentsController#confirm` already uses — a membership lookup and
    // an owner/admin check — rather than a new authorisation concept.
    const members = await listMembers(user.userId, tenantId);
    const role = members.find((m) => m.user_id === user.userId)?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ConflictException('Posting to the ledger is an owner or manager action.');
    }

    try {
      const outcome = await postTransaction(user.userId, tenantId, transactionId);
      if (!outcome.ok) {
        if (outcome.reason === 'missing') throw new NotFoundException('No such transaction.');
        throw new ConflictException(
          `This transaction is already ${outcome.status}, not a draft — nothing to post.`,
        );
      }
      return { transactionId, status: 'posted' };
    } catch (err) {
      // The deferred constraint trigger (migration 0006) rejects an
      // unbalanced posting at COMMIT, which surfaces here as a rejected
      // promise from the enclosing `withTenantAs` transaction, not as a
      // normal falsy outcome — and specifically as a rejection of the
      // `commit` itself, which drizzle wraps in its own `DrizzleQueryError`
      // rather than surfacing the driver's error directly. So the SQLSTATE
      // is checked on both the error and its `cause` — verified against a
      // real rejection (`transactions.test.ts`), not assumed from drizzle's
      // types. Recognised by Postgres's own code for a CHECK violation (what
      // the trigger raises with), translated into the same class of
      // response a client-side balance failure would give — never a bare
      // 500 for what is, structurally, a bad request.
      const code =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (code === '23514') {
        throw new ConflictException(
          "This transaction's splits do not sum to zero — Postgres refused to post it.",
        );
      }
      throw err;
    }
  }

  @Get('v1/transactions')
  @ApiOperation({ summary: 'Transactions, with their splits' })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('status') statusParam?: string,
  ): Promise<TransactionRow[]> {
    // Same pattern as `DocumentsController#list`'s `filter` query: a plain
    // param validated against a fixed set here, rather than a class-validator
    // DTO — this server runs under `tsx`/esbuild, which does not emit
    // `design:paramtypes`, so a `@Query()` DTO would silently skip validation
    // exactly as an unnamed `@Body()` DTO would (see `ValidBody`'s comment).
    const allowed = ['draft', 'posted', 'void'] as const;
    const status = allowed.includes(statusParam as never)
      ? (statusParam as (typeof allowed)[number])
      : undefined;
    return listTransactions(user.userId, tenantId, { status });
  }
}
