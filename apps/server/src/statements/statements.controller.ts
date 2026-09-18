import { ConflictException, Controller, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, MembershipGuard, SessionGuard, WorkspaceId, type AuthUser } from '../common/auth.guard.js';
import { listMembers } from '../repo.js';
import { postStatementLineStandalone, postUnmatchedStatementLines } from './statements.repo.js';

/**
 * R5d (`docs/STATEMENTS.md` §12 Lane R): posting a statement line as spending,
 * singly or in bulk, with no document behind it. D-S7 (§14.1c) is why this
 * exists at all — a line counts as spending the instant a statement is read,
 * but it only becomes a LEDGER TRANSACTION through one of these two acts.
 *
 * Same owner/admin rule `TransactionsController#post` uses for the equivalent
 * "moves the books" act — a membership lookup and an owner/admin check, not a
 * new authorisation concept.
 *
 * NOT YET REGISTERED in `app.module.ts`: that file is outside this ticket's
 * owned paths (`apps/server/src/statements/` only). Reported as a follow-up —
 * whoever owns `app.module.ts` next needs to add
 * `StatementsController` to its `controllers` array (or wrap it in a
 * `StatementsModule`, matching whichever convention the app is moving
 * toward) before either route is reachable over HTTP.
 */
@ApiTags('statements')
@Controller()
@UseGuards(SessionGuard, MembershipGuard)
export class StatementsController {
  @Post('v1/statement-lines/:id/post')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Post one statement line as spending, standalone — no document',
    description:
      'The merge rule with no document (`mergeObservations`, R5b): a debit line becomes an uncategorised Purchases split, a credit line an uncategorised Receipts split, both balanced against the line\'s own account. Refuses rather than re-posting a line that already carries a live observation — call this again on an already-posted line and nothing changes.',
  })
  async postOne(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') statementLineId: string,
  ): Promise<{ transactionId: string; status: 'posted' }> {
    await requireOwnerOrAdmin(user, tenantId);

    const outcome = await postStatementLineStandalone(user.userId, tenantId, statementLineId);
    if (outcome.ok) return { transactionId: outcome.transactionId, status: 'posted' };

    switch (outcome.reason) {
      case 'missing_statement_line':
        throw new NotFoundException('No such statement line.');
      case 'already_observed':
        throw new ConflictException(
          `This line already has a live transaction (${outcome.transactionId}) — nothing to post.`,
        );
    }
  }

  @Post('v1/statements/:id/post-unmatched')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Post every unmatched line on a statement as spending, in bulk',
    description:
      'Every line with no live observation is posted standalone, one transaction per line; every line that already has one — whether from a previous standalone post or a matched receipt — is left untouched and counted in `skipped`, never silently dropped.',
  })
  async postUnmatched(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') statementId: string,
  ): Promise<{ posted: string[]; skipped: number }> {
    await requireOwnerOrAdmin(user, tenantId);
    return postUnmatchedStatementLines(user.userId, tenantId, statementId);
  }
}

/** Same check `TransactionsController#post` runs before posting: staff may
 *  capture, not post. */
async function requireOwnerOrAdmin(user: AuthUser, tenantId: string): Promise<void> {
  const members = await listMembers(user.userId, tenantId);
  const role = members.find((m) => m.user_id === user.userId)?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new ConflictException('Posting to the ledger is an owner or manager action.');
  }
}
