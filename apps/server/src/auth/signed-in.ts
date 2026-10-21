import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@snap/api-contract';

import { getDb } from '../db.js';
import { getUser, listWorkspacesFor } from '../repo.js';
import { issueSession, issueYourTalSession, sqlState } from './sessions.js';

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
 * defeats its passkeys. Enforced in SQL, in the same statement that would
 * open the session (`identity_session_open` refuses with YT001, 0039), so a
 * sign-in racing a link cannot slip a session in; this only turns that
 * refusal into 403 `use_yourtal`. `method` is required so no caller can
 * forget to say which door it is.
 */
export async function signedIn(userId: string, method: SignInMethod): Promise<SignInResponse> {
  let token: string;
  try {
    token = method === 'yourtal' ? await issueYourTalSession(userId) : await issueSession(userId);
  } catch (error) {
    if (method === 'snapapp' && sqlState(error) === 'YT001') throw useYourTalInstead();
    throw error;
  }
  const user = await getUser(userId);
  if (!user) throw new Error(`signedIn: user ${userId} vanished between sign-in and response`);
  // Read the memberships with a user context and no tenant context — the one
  // query that is legitimately answered in that state (migration 0012).
  const workspaces = await listWorkspacesFor(getDb(), userId);
  return { token, user, workspaces };
}
