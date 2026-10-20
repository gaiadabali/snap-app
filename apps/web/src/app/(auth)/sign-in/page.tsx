import Link from 'next/link';
import type { Metadata } from 'next';

import { safeReturnPath } from '@/lib/auth/safe-redirect';
import { isYourtalWebSignInAvailable } from '@/lib/auth/yourtal';

import { AuthMethods } from '../_components/AuthMethods';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.returnTo, '/app');
  const yourtalEnabled = await isYourtalWebSignInAvailable();

  return (
    <div className="flex flex-col gap-6">
      <AuthMethods
        mode="sign-in"
        returnTo={returnTo}
        error={params.error}
        sent={params.sent === '1'}
        yourtalEnabled={yourtalEnabled}
      />
      <p className="auth-switch">
        New here?{' '}
        <Link
          href={`/register?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
