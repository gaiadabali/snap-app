import type { GodConsentPrompt, GodConsentState } from '@snap/api-contract';
import { listWorkspacesFor } from '@snap/db';

import { getDb } from '../db.js';
import { isTeen } from '../teens/teens.repo.js';
import { getGodConsentStatus, type GodConsentStatusRow } from './god-consent.repo.js';
import { GOD_NOTICE } from './notice.js';

/**
 * What the caller should be shown, decided here and never by a client.
 *
 *   teen                                  none (their parent answers; nothing is asked of a teen)
 *   answered for the CURRENT version      none (any answer: a decline is not re-asked until the version changes)
 *   anyone else, with no workspace yet    required (a new sign-up: tick to finish setup)
 *   anyone else, with a workspace         ask (Accept or "Not now"; never a lock-out)
 */
export function promptFor(input: { teen: boolean; status: GodConsentStatusRow | null; hasWorkspace: boolean }): GodConsentPrompt {
  if (input.teen) return 'none';
  if (input.status?.version === GOD_NOTICE.version) return 'none';
  return input.hasWorkspace ? 'ask' : 'required';
}

export async function godConsentState(userId: string): Promise<GodConsentState> {
  const [status, teen, workspaces] = await Promise.all([
    getGodConsentStatus(userId),
    isTeen(userId),
    listWorkspacesFor(getDb(), userId),
  ]);
  return {
    notice: GOD_NOTICE,
    status,
    prompt: promptFor({ teen, status, hasWorkspace: workspaces.length > 0 }),
    teen,
    accepted: status?.decision === 'accepted',
  };
}
