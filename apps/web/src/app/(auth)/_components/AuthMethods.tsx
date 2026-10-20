import Link from 'next/link';

import { devBypassSignInAction, requestMagicLinkAction } from '@/lib/auth/actions';
import { isDevBypassAvailable } from '@/lib/auth/dev-bypass';
import { isGoogleSignInSimulatorAvailable } from '@/lib/auth/google-simulator';
import { config } from '@/lib/config';

import { AuthField, AuthInput } from './ui';

/**
 * The ways in: Google (real or, on the demo host, simulated), a magic-link
 * email, and — development only — the bare-email bypass. Shared between
 * `/sign-in` and `/register` because the mechanism is identical; only the
 * framing text differs (this app's sign-in endpoint already creates an
 * unknown address's account, so "sign in" and "register" are the same
 * request).
 */
export function AuthMethods({
  mode,
  returnTo,
  error,
  sent,
}: {
  mode: 'sign-in' | 'register';
  returnTo: string;
  error?: string;
  sent?: boolean;
}) {
  const heading = mode === 'sign-in' ? 'Sign in' : 'Create your account';
  const lede =
    mode === 'sign-in'
      ? 'Use the same method you signed up with.'
      : 'No password to invent or remember — a link in your inbox is the whole account.';

  return (
    <div className="auth-panel">
      <div>
        <h1 className="auth-title">{heading}</h1>
        <p className="auth-lede">{lede}</p>
      </div>

      {error ? (
        <div role="alert" className="auth-alert auth-alert-error">
          {error}
        </div>
      ) : null}

      {sent ? (
        <div role="status" className="auth-alert auth-alert-ok">
          Check your email for a sign-in link. It expires in 15 minutes and works once.
        </div>
      ) : (
        <>
          {!config.googleOauthConfigured && isGoogleSignInSimulatorAvailable() ? (
            <Link
              href={`/auth/google-simulator?returnTo=${encodeURIComponent(returnTo)}`}
              className="btn btn-secondary btn-lg w-full"
            >
              Continue with Google (demo sign-in)
            </Link>
          ) : (
            <Link
              href={`/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
              className="btn btn-secondary btn-lg w-full"
            >
              Continue with Google
            </Link>
          )}

          {config.mailerConfigured ? (
            <>
              <div className="auth-divider">or</div>

              <form action={requestMagicLinkAction} className="auth-form">
                <input type="hidden" name="returnTo" value={returnTo} />
                <AuthField label="Email address" htmlFor="magic-email">
                  <AuthInput
                    id="magic-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </AuthField>
                <button type="submit" className="btn btn-primary btn-lg w-full">
                  Email me a sign-in link
                </button>
              </form>
            </>
          ) : (
            /*
             * No mail provider, so a magic link cannot be delivered. Offering
             * the form anyway would answer "check your email" for a message
             * that never arrives — a dead end that looks like a mail delay and
             * wastes a reviewer's time before they think to try anything else.
             * Say so instead, and point at the way in that does work.
             */
            <div className="auth-note">
              <strong>
                {mode === 'register'
                  ? 'Account creation is closed on this demo host.'
                  : 'Email sign-in is unavailable on this demo host.'}
              </strong>
              <p>
                No mail provider is configured, so a sign-in link cannot be delivered.
                {mode === 'register'
                  ? ' Use one of the demo identities above to explore every role — including the platform admin console.'
                  : ' Use the demo sign-in above.'}
              </p>
            </div>
          )}
        </>
      )}

      {!sent && isDevBypassAvailable() ? <DevBypass returnTo={returnTo} /> : null}
    </div>
  );
}

/**
 * Unmistakably development-only. `isDevBypassAvailable()` above already keeps
 * this whole block out of the render tree — and therefore out of the HTML
 * sent to the browser — whenever `NODE_ENV=production` or the explicit
 * `SNAP_DEV_AUTH_BYPASS` opt-in is not set; `devBypassSignInAction` checks
 * the same function again before doing anything, so this is a convenience,
 * not the actual boundary.
 */
function DevBypass({ returnTo }: { returnTo: string }) {
  return (
    <div className="auth-dev">
      <div className="flex flex-wrap items-center gap-2">
        <span className="auth-badge">Development only</span>
        <span className="text-[12px] font-medium text-[var(--s-amber)]">
          Never reachable when NODE_ENV=production
        </span>
      </div>
      <p>
        Trades a bare email for a session with no proof you own it. Stands in for the Google
        exchange until staging credentials exist.
      </p>
      <form action={devBypassSignInAction} className="auth-form">
        <input type="hidden" name="returnTo" value={returnTo} />
        <AuthField label="Email address" htmlFor="dev-email">
          <AuthInput id="dev-email" name="email" type="email" placeholder="you@example.com" required />
        </AuthField>
        <button type="submit" className="btn btn-secondary btn-lg w-full">
          Sign in without verification (dev)
        </button>
      </form>
    </div>
  );
}
