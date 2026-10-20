import type { AuthUser } from '@snap/api-contract';

import { getDb } from '../db.js';
import { getUser, listWorkspacesFor } from '../repo.js';
import { issueSession } from './sessions.js';

/** What every sign-in shaped endpoint returns. */
export type SignInResponse = {
  token: string;
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
};

/**
 * Open a session for a user who has just authenticated, and answer the way
 * every sign-in route does.
 *
 * One function for all of them — password, register, magic link, Google, the
 * demo routes, a password reset — so a session is never minted any other way
 * and `user` is always read back fresh (with `emailVerified` as the database
 * has it now, not as the route assumed it).
 */
export async function signedIn(userId: string): Promise<SignInResponse> {
  const token = await issueSession(userId);
  const user = await getUser(userId);
  if (!user) throw new Error(`signedIn: user ${userId} vanished between sign-in and response`);
  // Read the memberships with a user context and no tenant context — the one
  // query that is legitimately answered in that state (migration 0012).
  const workspaces = await listWorkspacesFor(getDb(), userId);
  return { token, user, workspaces };
}
