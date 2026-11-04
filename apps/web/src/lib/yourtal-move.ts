/**
 * Whether to ask a signed-in person to move their account to YourTal (group
 * 3.6.e). Only an account the server says is NOT linked (`yourtalLinked ===
 * false`; absent means an older server and shows nothing), only while the web
 * client can sign in with YourTal, never inside a teen's space (teens only
 * ever arrive through YourTal), never while staff impersonate, and not after
 * the person said "Not now".
 */
export const YOURTAL_MOVE_COOKIE = 'snap_yourtal_move_dismissed';

/** `/app?yourtal_move=email_mismatch`: where the callback sends a move whose YourTal email was another one. */
export const YOURTAL_MOVE_PARAM = 'yourtal_move';
export const YOURTAL_MOVE_MISMATCH = 'email_mismatch';

/** The person's own address, shown only to them in their own signed-in page. */
export const moveMismatchMessage = (email: string): string =>
  `Your YourTal account uses a different email. Use the YourTal account with ${email}, or change your SnapApp email first.`;

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
