import Link from 'next/link';
import type { Metadata } from 'next';

import { safeReturnPath } from '@/lib/auth/safe-redirect';

import { AuthMethods } from '../_components/AuthMethods';

export const metadata: Metadata = { title: 'Create your account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  // A brand-new account has no workspace yet, so there is nowhere useful to
  // "return to" — onboarding is always next regardless of what a stray
  // `returnTo` on this URL says. It is still validated (never trusted
  // outright) because it is threaded through to `/auth/google` and the
  // magic-link request, which DO carry it forward as the eventual
  // post-onboarding destination.
  const returnTo = safeReturnPath(params.returnTo, '/app');

  return (
    <div className="flex flex-col gap-4">
      <AuthMethods
        mode="register"
        returnTo={returnTo}
        error={params.error}
        sent={params.sent === '1'}
      />
      <p className="text-center text-[13px] text-[var(--color-ink-muted)]">
        Already have an account?{' '}
        <Link
          href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-[var(--color-accent)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
