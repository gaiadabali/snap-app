import { Badge, Button, ButtonLink, Card, Field, Input } from '@/design/primitives';
import { devBypassSignInAction, requestMagicLinkAction } from '@/lib/auth/actions';
import { isDevBypassAvailable } from '@/lib/auth/dev-bypass';
import { isGoogleSignInSimulatorAvailable } from '@/lib/auth/google-simulator';
import { config } from '@/lib/config';

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
    <Card className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">
          {heading}
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--color-ink-muted)]">{lede}</p>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] px-3 py-2 text-[13px] text-[var(--color-risk)]">
          {error}
        </div>
      ) : null}

      {sent ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-[13px] text-[var(--color-good)]">
          Check your email for a sign-in link. It expires in 15 minutes and works once.
        </div>
      ) : (
        <>
          {!config.googleOauthConfigured && isGoogleSignInSimulatorAvailable() ? (
            <ButtonLink
              href={`/auth/google-simulator?returnTo=${encodeURIComponent(returnTo)}`}
              variant="secondary"
              size="lg"
              className="w-full"
            >
              Continue with Google (demo sign-in)
            </ButtonLink>
          ) : (
            <ButtonLink
              href={`/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
              variant="secondary"
              size="lg"
              className="w-full"
            >
              Continue with Google
            </ButtonLink>
          )}

          {config.mailerConfigured ? (
            <>
              <div className="flex items-center gap-3 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                <span className="h-px flex-1 bg-[var(--color-rule)]" />
                or
                <span className="h-px flex-1 bg-[var(--color-rule)]" />
              </div>

              <form action={requestMagicLinkAction} className="flex flex-col gap-4">
                <input type="hidden" name="returnTo" value={returnTo} />
                <Field label="Email address" htmlFor="magic-email">
                  <Input
                    id="magic-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </Field>
                <Button type="submit" size="lg">
                  Email me a sign-in link
                </Button>
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
            <div className="rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-surface-alt)] px-3 py-3 text-[13px] text-[var(--color-ink-muted)]">
              <strong className="font-semibold text-[var(--color-ink)]">
                {mode === 'register'
                  ? 'Account creation is closed on this demo host.'
                  : 'Email sign-in is unavailable on this demo host.'}
              </strong>
              <p className="mt-1">
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
    </Card>
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
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4">
      <div className="flex items-center gap-2">
        <Badge tone="warn">Development only</Badge>
        <span className="text-[12px] text-[var(--color-warn)]">
          Never reachable when NODE_ENV=production
        </span>
      </div>
      <p className="text-[13px] text-[var(--color-ink-muted)]">
        Trades a bare email for a session with no proof you own it. Stands in for the Google
        exchange until staging credentials exist.
      </p>
      <form action={devBypassSignInAction} className="flex flex-col gap-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field label="Email address" htmlFor="dev-email">
          <Input id="dev-email" name="email" type="email" placeholder="you@example.com" required />
        </Field>
        <Button type="submit" variant="secondary">
          Sign in without verification (dev)
        </Button>
      </form>
    </div>
  );
}
