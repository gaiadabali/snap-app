import {
  BadRequestException,
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
import type {
  AcceptMatchCandidateRequest,
  ManualMatchRequest,
  MatchCandidateStatus,
  MatchCandidateView,
  MatchVarianceKind,
} from '@snap/api-contract';
import { IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { listMembers } from '../repo.js';
import {
  acceptCandidate,
  listCandidates,
  manualLink,
  rejectCandidate,
  unlinkObservation,
  type DecideOutcome,
} from './reconciliation.repo.js';

/* ── Request DTOs ──────────────────────────────────────────────────────────── */

export class VarianceDto implements NonNullable<AcceptMatchCandidateRequest['variance']> {
  @IsIn(['tip', 'surcharge', 'other']) kind!: MatchVarianceKind;
}

export class AcceptCandidateDto implements AcceptMatchCandidateRequest {
  @IsOptional() @ValidateNested() @Type(() => VarianceDto) variance?: VarianceDto;
}

export class ManualLinkDto implements ManualMatchRequest {
  @IsUUID() statementLineId!: string;
  @IsUUID() documentId!: string;
  @IsOptional() @ValidateNested() @Type(() => VarianceDto) variance?: VarianceDto;
}

const CANDIDATE_STATUSES: readonly MatchCandidateStatus[] = ['suggested', 'accepted', 'rejected', 'unlinked'];

/**
 * Reconciliation: candidates, and accept / reject / unlink / manual link.
 *
 * `docs/STATEMENTS.md` §5.3.1 / §12 R5c. Every state change that touches the
 * ledger goes through `transactions.repo.ts`'s `supersedeAndPost` (R5b) —
 * this controller and `reconciliation.repo.ts` never draft or post a split
 * themselves. D-S6 (§14.1c): accept and manual-link both POST immediately,
 * under the same owner/admin rule `TransactionsController#post` already
 * carries — there is no second "confirm" step after either.
 */
@ApiTags('reconciliation')
@Controller('v1/reconciliation')
@UseGuards(SessionGuard, MembershipGuard)
export class ReconciliationController {
  /**
   * A concurrent accept race — two candidates proposing to settle the SAME
   * statement line — is decided by a real Postgres lock, not a guess: both
   * `supersedeAndPost` calls take `SELECT ... FOR UPDATE` on the statement
   * line, so the second blocks until the first commits. Verified by actually
   * running two concurrent accepts against real Postgres
   * (`reconciliation.e2e.test.ts`), not assumed from reading the code: the
   * loser does NOT fail on `event_observations_line_once` (a plain UNIQUE
   * index) the way a first read of migration 0032 suggests it might — it
   * unblocks, sees the winner's now-committed `statement_line` observation,
   * and (per `supersedeAndPost`'s own "whatever transaction currently
   * materialises this evidence gets voided" rule) tries to void the WINNING
   * transaction too, which still carries the winner's own, unrelated
   * `document` observation. Migration 0032's OTHER deferred trigger —
   * `assert_no_observation_on_void`, "a void transaction may carry no
   * observation" — is what actually refuses it, as SQLSTATE 23514, at the
   * loser's COMMIT. Either code from either trigger is the same shape of
   * failure (two requests wanted mutually exclusive states; Postgres said
   * only one may have it) and gets the same 409 — never the bare 500 an
   * unrecognised thrown error would otherwise become, the same discipline
   * `TransactionsController#post` already applies to its own 23514.
   *
   * The loser's whole `withTenantAs` transaction rolls back on this failure,
   * so nothing it attempted (voiding the winner, its own draft) survives —
   * the winner's transaction is untouched, and the loser's own candidate
   * stays exactly `'suggested'`, ready to be decided again.
   */
  private mapConflict(err: unknown): never {
    const code =
      (err as { code?: string } | undefined)?.code ??
      (err as { cause?: { code?: string } } | undefined)?.cause?.code;
    if (code === '23505' || code === '23514') {
      throw new ConflictException(
        'That statement line or document is already linked to another event — someone else got there first.',
      );
    }
    throw err;
  }

  private async requireOwnerOrAdmin(user: AuthUser, tenantId: string): Promise<void> {
    const members = await listMembers(user.userId, tenantId);
    const role = members.find((m) => m.user_id === user.userId)?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ConflictException('Linking or unlinking a match is an owner or manager action.');
    }
  }

  private async requireNonReadonly(user: AuthUser, tenantId: string): Promise<void> {
    const members = await listMembers(user.userId, tenantId);
    const role = members.find((m) => m.user_id === user.userId)?.role;
    if (role === 'readonly') {
      throw new ConflictException('A read-only member cannot reject a match.');
    }
  }

  private throwForDecideFailure(outcome: Exclude<DecideOutcome, { ok: true }>): never {
    switch (outcome.reason) {
      case 'missing_candidate':
        throw new NotFoundException('No such candidate.');
      case 'already_decided':
        throw new ConflictException(`This candidate is already ${outcome.status}, not suggested.`);
      case 'missing_document':
        throw new NotFoundException('No such document.');
      case 'missing_statement_line':
        throw new NotFoundException('No such statement line.');
      case 'document_not_confirmed':
        throw new ConflictException(
          `This document is ${outcome.reviewStatus.replace('_', ' ')}, not confirmed — review it before accepting a match against it.`,
        );
      case 'ambiguous_tax_categories':
        throw new UnprocessableEntityException(
          'This document mixes tax treatments with no per-category reconciliation on record — cannot merge it safely.',
        );
      case 'lines_dont_reconcile':
        throw new UnprocessableEntityException(
          `The document's lines do not add up to its total (off by ${outcome.gap}) — correct the document before matching it.`,
        );
      case 'amount_disagreement':
        throw new UnprocessableEntityException(
          `The receipt (${outcome.documentAmount}) and the statement line (${outcome.lineAmount}) disagree — name a variance (tip, surcharge, other) to accept it anyway.`,
        );
      case 'currency_mismatch':
        throw new UnprocessableEntityException(
          `The document is ${outcome.documentCurrency} and the statement line's account is ${outcome.lineCurrency} — they cannot be the same event.`,
        );
      case 'no_evidence':
        // Unreachable from either caller: `acceptCandidate` and `manualLink`
        // always pass both a documentId and a statementLineId.
        throw new Error('reconciliation: supersedeAndPost refused no_evidence from a candidate decision');
    }
  }

  @Get('candidates')
  @ApiOperation({
    summary: 'Match candidates for a statement or a document',
    description:
      'The matcher runs on read: any candidate missing for the given statement or document is generated here, idempotently, before the list is returned. Exactly one of statementId/documentId is required.',
  })
  async candidates(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('statementId') statementId?: string,
    @Query('documentId') documentId?: string,
    @Query('status') statusParam?: string,
  ): Promise<MatchCandidateView[]> {
    if ((!statementId && !documentId) || (statementId && documentId)) {
      throw new BadRequestException('Supply exactly one of statementId or documentId.');
    }
    const status = (CANDIDATE_STATUSES as readonly string[]).includes(statusParam ?? '')
      ? (statusParam as MatchCandidateStatus)
      : undefined;

    const outcome = await listCandidates(user.userId, tenantId, { statementId, documentId, status });
    if (!outcome.ok) {
      throw new NotFoundException(
        outcome.reason === 'missing_statement' ? 'No such statement.' : 'No such document.',
      );
    }
    return outcome.candidates;
  }

  @Post('candidates/:id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept a match — the act of posting it (D-S6)',
    description:
      'One tap, under the same owner/admin rule posting already has. Supersedes any transaction(s) currently materialising either side of the evidence and posts the merged one. Refuses 409 if the document is not yet confirmed.',
  })
  async accept(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') candidateId: string,
    @ValidBody(AcceptCandidateDto) body: AcceptCandidateDto,
  ): Promise<{ transactionId: string; status: 'posted' }> {
    await this.requireOwnerOrAdmin(user, tenantId);
    try {
      const outcome = await acceptCandidate(user.userId, tenantId, candidateId, body.variance);
      if (!outcome.ok) this.throwForDecideFailure(outcome);
      return { transactionId: outcome.transactionId, status: 'posted' };
    } catch (err) {
      this.mapConflict(err);
    }
  }

  @Post('candidates/:id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a candidate — any non-readonly member',
    description:
      'A rejected pair is never re-suggested: `match_candidates`\' unique (statement_line_id, document_id) pair is for life.',
  })
  async reject(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') candidateId: string,
  ): Promise<{ candidateId: string; status: 'rejected' }> {
    await this.requireNonReadonly(user, tenantId);
    const outcome = await rejectCandidate(user.userId, tenantId, candidateId);
    if (!outcome.ok) {
      if (outcome.reason === 'missing_candidate') throw new NotFoundException('No such candidate.');
      throw new ConflictException(`This candidate is already ${outcome.status}, not suggested.`);
    }
    return { candidateId, status: 'rejected' };
  }

  @Post('matches')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Manually link a statement line and a document',
    description:
      'Not subject to the matcher\'s card-mismatch exclusion — that governs what is SUGGESTED, never what a person may deliberately link. Posts immediately (D-S6), same owner/admin rule as accept.',
  })
  async manualMatch(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(ManualLinkDto) body: ManualLinkDto,
  ): Promise<{ transactionId: string; status: 'posted' }> {
    await this.requireOwnerOrAdmin(user, tenantId);
    try {
      const outcome = await manualLink(user.userId, tenantId, {
        statementLineId: body.statementLineId,
        documentId: body.documentId,
        variance: body.variance,
      });
      if (!outcome.ok) this.throwForDecideFailure(outcome as Exclude<DecideOutcome, { ok: true }>);
      return { transactionId: outcome.transactionId, status: 'posted' };
    } catch (err) {
      this.mapConflict(err);
    }
  }

  @Post('observations/:id/unlink')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Undo a match — the same act, backwards (§5.3.1 Q5)',
    description:
      'Deletes the statement-line observation, flips its candidate to unlinked, and re-materialises the remaining evidence: the merged transaction is superseded by a receipt-only one, split-for-split equal to what existed before the match. The line returns to the unmatched queue.',
  })
  async unlink(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') observationId: string,
  ): Promise<{ transactionId: string; status: 'posted' }> {
    await this.requireOwnerOrAdmin(user, tenantId);
    try {
      const outcome = await unlinkObservation(user.userId, tenantId, observationId);
      if (!outcome.ok) {
        switch (outcome.reason) {
          case 'missing_observation':
            throw new NotFoundException('No such observation.');
          case 'not_a_statement_line_observation':
            throw new UnprocessableEntityException(
              'Only a statement-line observation can be unlinked here — this one is a document observation.',
            );
          case 'not_a_match':
            throw new UnprocessableEntityException(
              'This statement line was posted standalone, not matched to a document — nothing to unlink.',
            );
          default:
            this.throwForDecideFailure(outcome);
        }
      }
      return { transactionId: outcome.transactionId, status: 'posted' };
    } catch (err) {
      this.mapConflict(err);
    }
  }
}
