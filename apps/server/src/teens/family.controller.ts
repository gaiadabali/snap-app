import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FamilyStatus, TeenInviteCreated } from '@snap/api-contract';
import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { CurrentUser, MembershipGuard, SessionGuard, WorkspaceId, type AuthUser } from '../common/auth.guard.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { listMembers } from '../repo.js';
import { createTeenInvite, endTeenInvite, teenInvitesConfigured } from './invite-api.js';
import { endTeenSpace, familyOf, isTeen, queueInviteEnd, recordInvite, spaceOfParent } from './teens.repo.js';

const refuse = (status: HttpStatus, error: string, message: string) => new HttpException({ error, message }, status);

/** The caller's own YourTal `sub`, read inside a workspace they belong to (users RLS). */
async function yourtalSub(userId: string, tenantId: string): Promise<string | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ subject: string }>(sql`select subject from users where id = current_user_id()`);
    const subject = rows[0]?.subject ?? '';
    return subject.startsWith('yourtal|') ? subject.slice('yourtal|'.length) : null;
  });
}

/**
 * Family: a parent invites their teen (group 3.10; yourtal docs/26 §3.3).
 *
 *   POST /v1/family/invites            the parent, in a workspace they own:
 *                                      YourTal makes the invite, this answers
 *                                      the join link (shown once)
 *   GET  /v1/family                    the parent's teens and open invites,
 *                                      and, for a teen, who can see their space
 *   POST /v1/family/teens/:id/end      the parent ends the teen's access
 *
 * The teen's scans spend credits from the workspace the invite was made in
 * (0045), so only its owner may invite.
 */
@ApiTags('family')
@Controller('v1/family')
@UseGuards(SessionGuard)
export class FamilyController {
  private readonly logger = new Logger('family');

  @Get()
  @ApiOperation({ summary: 'Your teens, open invites, and (for a teen) who can see your space' })
  async status(@CurrentUser() user: AuthUser): Promise<FamilyStatus> {
    const rows = await familyOf(user.userId);
    return { invitesAvailable: teenInvitesConfigured(), ...rows };
  }

  @Post('invites')
  @HttpCode(201)
  @UseGuards(MembershipGuard)
  @ApiOperation({
    summary: 'Invite your teen',
    description:
      'Asks YourTal for an invite for the signed-in parent and answers the join link. The teen’s scans will spend ' +
      'this workspace’s credits, so only its owner may invite. Refusals: 501 not_configured, 403 not_owner, ' +
      'teen_space, yourtal_sign_in_required, parent_not_eligible; 429 too_many_invites; 503 yourtal_unavailable.',
  })
  async invite(@CurrentUser() user: AuthUser, @WorkspaceId() tenantId: string): Promise<TeenInviteCreated> {
    if (!teenInvitesConfigured()) {
      throw refuse(HttpStatus.NOT_IMPLEMENTED, 'not_configured', 'Inviting a teen isn’t available yet.');
    }
    const role = (await listMembers(user.userId, tenantId)).find((m) => m.user_id === user.userId)?.role;
    if (role !== 'owner') {
      throw refuse(HttpStatus.FORBIDDEN, 'not_owner', 'Only the owner of this workspace can invite a teen to it.');
    }
    // A teen space's only owner is its teen.
    if (await isTeen(user.userId)) {
      throw refuse(HttpStatus.FORBIDDEN, 'teen_space', 'A teen account can’t invite anyone.');
    }
    const parentSub = await yourtalSub(user.userId, tenantId);
    if (!parentSub) {
      throw refuse(
        HttpStatus.FORBIDDEN,
        'yourtal_sign_in_required',
        'Sign in with YourTal first. Your teen joins with the teen account you approved in YourTal.',
      );
    }

    const made = await createTeenInvite(parentSub);
    if (!made.ok) {
      this.logger.warn(`teen invite refused: ${made.reason} user=${user.userId}`);
      if (made.reason === 'parent_not_eligible') {
        throw refuse(
          HttpStatus.FORBIDDEN,
          'parent_not_eligible',
          'YourTal can’t make an invite from your account. Only a verified adult account in good standing can invite a teen.',
        );
      }
      if (made.reason === 'too_many_invites') {
        throw refuse(HttpStatus.TOO_MANY_REQUESTS, 'too_many_invites', 'You can make 10 invites a day. Try again tomorrow.');
      }
      throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', 'YourTal isn’t answering right now. Please try again in a few minutes.');
    }

    await recordInvite(user.userId, {
      inviteId: made.inviteId,
      fundingTenantId: tenantId,
      code: made.code,
      expiresAt: made.expiresAt,
    });
    this.logger.log(`teen invite made: invite=${made.inviteId} user=${user.userId}`);
    const joinUrl = new URL('/auth/yourtal', config().WEB_PUBLIC_URL);
    joinUrl.searchParams.set('teenInvite', made.code);
    return { inviteId: made.inviteId, joinUrl: joinUrl.href, expiresAt: made.expiresAt };
  }

  @Post('teens/:workspaceId/end')
  @HttpCode(200)
  @ApiOperation({
    summary: 'End your teen’s access',
    description:
      'Ends the teen’s sessions here and starts the 30-day hold before their space is erased, then ends the invite at ' +
      'YourTal (404 there counts as ended; a failure is retried by the worker). Idempotent. 404 for a space you did not invite.',
  })
  async end(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
  ): Promise<{ ended: true }> {
    const space = await spaceOfParent(user.userId, workspaceId);
    if (!space) throw new NotFoundException({ error: 'not_found', message: 'No such teen space.' });
    if (space.accessEndedAt) return { ended: true };

    const parentSub = await yourtalSub(user.userId, workspaceId);
    if (!parentSub) throw new ForbiddenException({ error: 'yourtal_sign_in_required', message: 'Sign in with YourTal first.' });
    // Here first, so the teen is out whatever YourTal answers: sessions end and
    // sign-in refuses an ended space. Then YourTal; a failure is the worker's to retry.
    await endTeenSpace(user.userId, workspaceId);
    const atYourTal = await endTeenInvite(space.inviteId, parentSub);
    if (atYourTal === 'failed') await queueInviteEnd(user.userId, workspaceId, parentSub);
    this.logger.log(`teen access ended: space=${workspaceId} user=${user.userId} yourtal=${atYourTal}`);
    return { ended: true };
  }
}
