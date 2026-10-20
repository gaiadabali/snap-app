/**
 * Real sessions for e2e suites (0036).
 *
 * A bearer token is only valid while a `user_sessions` row stands behind it,
 * so a suite can no longer sign a token for an arbitrary id and send it: the
 * session has to be OPENED, against a user that exists, through the same
 * `issueSession` the sign-in routes use. That is async, while most suites
 * build headers synchronously per request — so the sessions are opened once,
 * up front, and handed back as a lookup.
 *
 * Asking for a user that was not opened throws instead of returning a dead
 * token, so a missing id fails loudly at the call site rather than as a
 * puzzling 401 three assertions later.
 */
export async function openSessions(...userIds: string[]): Promise<(userId: string) => string> {
  const { issueSession } = await import('../auth/sessions.js');
  const tokens = new Map<string, string>();
  for (const userId of userIds) tokens.set(userId, await issueSession(userId));
  return (userId: string) => {
    const token = tokens.get(userId);
    if (!token) throw new Error(`openSessions: no session was opened for ${userId}`);
    return token;
  };
}
