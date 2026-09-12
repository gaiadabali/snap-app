import Link from 'next/link';
import type { Metadata } from 'next';

import { safeReturnPath } from '@/lib/auth/safe-redirect';

import { AuthMethods } from '../_components/AuthMethods';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.returnTo, '/app');

  return (
    <div className="flex flex-col gap-4">
      <AuthMethods
        mode="sign-in"
        returnTo={returnTo}
        error={params.error}
        sent={params.sent === '1'}
      />
      <p className="text-center text-[13px] text-[var(--color-ink-muted)]">
        New here?{' '}
        <Link
          href={`/register?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-[var(--color-accent)] hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
