import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@snap/api-contract';

import { getDb } from '../db.js';
import { getUser, listWorkspacesFor } from '../repo.js';
import { issueSession } from './sessions.js';
import { isLinkedToYourTal } from './yourtal-signin/repo.js';

/** What every sign-in shaped endpoint returns. */
export type SignInResponse = {
  token: string;
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
};

/**
 * How the person proved who they are.
 *
 *   yourtal  Sign in with YourTal (auth/yourtal-signin).
 *   snapapp  one of SnapApp's own methods: password, magic link, Google, the
 *            development and demo routes, a password reset.
 */
export type SignInMethod = 'yourtal' | 'snapapp';

/** The refusal a linked account gets from SnapApp's own sign-in methods. */
export function useYourTalInstead(): ForbiddenException {
  return new ForbiddenException({
    error: 'use_yourtal',
    message: 'This account signs in with YourTal now. Use “Sign in with YourTal”.',
  });
}

/**
 * Open a session for a user who has just authenticated, and answer the way
 * every sign-in route does.
 *
 * One function for all of them — password, register, magic link, Google, the
 * demo routes, a password reset, YourTal — so a session is never minted any
 * other way and `user` is always read back fresh (with `emailVerified` as the
 * database has it now, not as the route assumed it).
 *
 * THE DOOR RULE (docs/26 §1.10). Once an account is linked to YourTal, SnapApp's
 * own methods may not open a session for it: a weaker door beside YourTal
 * defeats its passkeys. Checked here, where every route passes, rather than
 * remembered in each route; `method` is required so no caller can forget to
 * say which door it is.
 */
export async function signedIn(userId: string, method: SignInMethod): Promise<SignInResponse> {
  if (method === 'snapapp' && (await isLinkedToYourTal(userId))) throw useYourTalInstead();
  const token = await issueSession(userId);
  const user = await getUser(userId);
  if (!user) throw new Error(`signedIn: user ${userId} vanished between sign-in and response`);
  // Read the memberships with a user context and no tenant context — the one
  // query that is legitimately answered in that state (migration 0012).
  const workspaces = await listWorkspacesFor(getDb(), userId);
  return { token, user, workspaces };
}
