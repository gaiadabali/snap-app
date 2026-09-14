import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

import { Badge, Button, Card, Container, Field, Input } from '@/design/primitives';
import { ApiError, api } from '@/lib/api/server';
import { googleSimulatorSignInAction } from '@/lib/auth/actions';
import { isGoogleSignInSimulatorAvailable } from '@/lib/auth/google-simulator';
import { safeReturnPath } from '@/lib/auth/safe-redirect';

export const metadata: Metadata = { title: 'Demo sign-in' };

type DemoIdentity = { userId: string; email: string; displayName: string };

/**
 * The fake consent screen.
 *
 * Deliberately does NOT reproduce Google's account chooser — no Google logo,
 * no wordmark, no "Sign in with Google" button styling. This is shown to
 * investors on the demo host, and a screen that LOOKS like genuine Google
 * sign-in while not being one is exactly the kind of thing that misleads the
 * people it is shown to. The banner below says plainly, in the first
 * sentence, that no Google account is contacted.
 *
 * `isGoogleSignInSimulatorAvailable()` is checked here — the same function
 * `AuthMethods` checks before rendering the button that links here — and
 * `googleSimulatorSignInAction` checks it again before minting anything, so
 * reaching this page with the simulator disabled (a stale link, a flipped
 * flag) lands back on `/sign-in` rather than a broken picker.
 */
export default async function GoogleSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.returnTo, '/app');

  if (!isGoogleSignInSimulatorAvailable()) {
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let identities: DemoIdentity[] = [];
  try {
    identities = await api<DemoIdentity[]>('/v1/auth/google-simulator/identities', {
      anonymous: true,
    });
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : 'The demo sign-in is not available right now.';
    redirect(
      `/sign-in?error=${encodeURIComponent(message)}&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-ground)]">
      <header className="border-b border-[var(--color-rule)] py-5">
        <Container width="prose">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]"
          >
            Snap Apps
          </Link>
        </Container>
      </header>
      <main className="flex flex-1 items-center justify-center py-12">
        <Container width="prose">
          <div className="mx-auto flex w-full max-w-[420px] flex-col gap-6">
            <Card className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone="warn">Simulated sign-in</Badge>
                  <span className="text-[12px] text-[var(--color-warn)]">Not real Google</span>
                </div>
                <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">
                  Choose a demo identity
                </h1>
                <p className="text-[14px] text-[var(--color-ink-muted)]">
                  This demo host stands in for Google sign-in — no Google account is contacted or
                  verified. Everything after you pick an identity (session, onboarding, workspace,
                  permissions) runs exactly as it would for a real sign-in.
                </p>
              </div>

              {params.error ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] px-3 py-2 text-[13px] text-[var(--color-risk)]">
                  {params.error}
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                {identities.length === 0 ? (
                  <p className="text-[13px] text-[var(--color-ink-muted)]">
                    No demo identities are seeded on this host yet.
                  </p>
                ) : (
                  identities.map((identity) => (
                    <form key={identity.userId} action={googleSimulatorSignInAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="email" value={identity.email} />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="lg"
                        className="flex w-full items-center justify-between gap-3"
                      >
                        <span>{identity.displayName}</span>
                        <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">
                          {identity.email}
                        </span>
                      </Button>
                    </form>
                  ))
                )}
              </div>

              <div className="flex items-center gap-3 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                <span className="h-px flex-1 bg-[var(--color-rule)]" />
                or enter one
                <span className="h-px flex-1 bg-[var(--color-rule)]" />
              </div>

              <form action={googleSimulatorSignInAction} className="flex flex-col gap-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <Field label="Demo identity email" htmlFor="google-sim-email">
                  <Input
                    id="google-sim-email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    placeholder="one of the addresses above"
                    required
                  />
                </Field>
                <Button type="submit" size="lg">
                  Sign in with this demo identity
                </Button>
              </form>
            </Card>

            <p className="text-center text-[13px] text-[var(--color-ink-muted)]">
              <Link
                href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
                className="font-semibold text-[var(--color-accent)] hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </Container>
      </main>
    </div>
  );
}
