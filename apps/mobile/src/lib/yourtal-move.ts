/**
 * Whether to ask a signed-in person to move their account to YourTal (group
 * 3.6.e). Only an account the server says is NOT linked (`yourtalLinked ===
 * false`; absent means an older server and shows nothing), only while the
 * phone client can sign in with YourTal, never inside a teen's space, and not
 * after "Not now".
 */
export const YOURTAL_MOVE_KEY = 'snap.yourtalMoveDismissed';

export const MOVE_COPY = {
  title: 'Sign in with YourTal to keep your account',
  body:
    'SnapApp now uses YourTal to sign in. Use the same email address as this account and everything stays yours: your receipts, budgets and points. From then on you sign in with YourTal.',
  action: 'Sign in with YourTal',
  notNow: 'Not now',
} as const;

/** The person's own address, shown only to them in their own Settings. */
export const moveMismatchMessage = (email: string): string =>
  `Your YourTal account uses a different email. Use the YourTal account with ${email}, or change your SnapApp email first.`;

export function showYourtalMove(input: {
  yourtalLinked: boolean | undefined;
  teenSpace: 'teen' | 'parent' | null | undefined;
  available: boolean;
  dismissed: boolean;
}): boolean {
  return input.yourtalLinked === false && input.teenSpace !== 'teen' && input.available && !input.dismissed;
}
