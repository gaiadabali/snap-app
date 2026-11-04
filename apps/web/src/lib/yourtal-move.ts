/**
 * Whether to ask a signed-in person to move their account to YourTal (group
 * 3.6.e). Only an account the server says is NOT linked (`yourtalLinked ===
 * false`; absent means an older server and shows nothing), only while the web
 * client can sign in with YourTal, never inside a teen's space (teens only
 * ever arrive through YourTal), never while staff impersonate, and not after
 * the person said "Not now".
 */
export const YOURTAL_MOVE_COOKIE = 'snap_yourtal_move_dismissed';

export function showYourtalMove(input: {
  yourtalLinked: boolean | undefined;
  teenSpace: 'teen' | 'parent' | null | undefined;
  impersonating: boolean;
  available: boolean;
  dismissed: boolean;
}): boolean {
  return (
    input.yourtalLinked === false &&
    input.teenSpace !== 'teen' &&
    !input.impersonating &&
    input.available &&
    !input.dismissed
  );
}
