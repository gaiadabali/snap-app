import { BadRequestException } from '@nestjs/common';
import { listWorkspacesFor } from '@snap/db';

import { getDb } from '../db.js';

import { recordGodConsent } from './god-consent.repo.js';
import { godConsentState } from './god-consent.service.js';
import { GOD_NOTICE } from './notice.js';

/**
 * Finishing a NEW sign-up needs the GOD Group Privacy Notice accepted: the
 * ticked box in this request, or an acceptance of the current version already
 * on record. Without either, 400 `god_notice_required`, and nothing is made.
 * A teen is skipped (the parent accepts for them, and a teen's space is not made here).
 */
export async function requireGodNoticeAtSignUp(userId: string, ticked: boolean): Promise<void> {
  const state = await godConsentState(userId);
  if (state.teen) return;
  if (ticked) {
    await recordGodConsent(userId, { version: GOD_NOTICE.version, decision: 'accepted', method: 'registration' });
    return;
  }
  if (state.status?.decision === 'accepted' && state.status.version === GOD_NOTICE.version) return;
  throw new BadRequestException({
    error: 'god_notice_required',
    message: 'Tick the box to accept the GOD Group Privacy Notice to finish setting up your account.',
  });
}

/**
 * The same rule for `POST /v1/workspaces`, so creating the first workspace directly cannot
 * step round onboarding. It applies only to a SIGN-UP: a caller with no workspace yet and no
 * consent record. Someone who already has a workspace, or has answered, is unaffected, and
 * onboarding (which records the acceptance first) passes through here without a second ask.
 */
export async function requireGodNoticeForFirstWorkspace(userId: string, ticked: boolean): Promise<void> {
  const [state, workspaces] = await Promise.all([godConsentState(userId), listWorkspacesFor(getDb(), userId)]);
  if (state.teen || workspaces.length > 0 || state.status !== null) return;
  await requireGodNoticeAtSignUp(userId, ticked);
}
