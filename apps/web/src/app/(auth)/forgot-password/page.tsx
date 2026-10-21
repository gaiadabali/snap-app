import Link from 'next/link';
import type { Metadata } from 'next';

import { authNotice } from '@/lib/auth/auth-errors';
import { requestPasswordResetAction } from '@/lib/auth/account-actions';

import { AuthField, AuthInput } from '../_components/ui';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * Ask for a password-reset link (task 1.2.a).
 *
 * Passwords are used in the phone app; this page exists for the link in the
 * "your password was changed" email ("if this was not you, reset it now")
 * and for anyone who would rather do it at a desk. The answer is the same
 * whether or not the address has an account.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const notice = authNotice(params.error);
  const sent = params.sent === '1';

  return (
    <div className="flex flex-col gap-6">
      <div className="auth-panel">
        <div>
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-lede">
            Give us the email on your account and we send a link to choose a new password.
          </p>
        </div>

        {notice ? (
          <div role="alert" className="auth-alert auth-alert-error">
            {notice.message}
          </div>
        ) : null}

        {sent ? (
          <div role="status" className="auth-alert auth-alert-ok">
            If that address has an account, a link is on its way. It works once, for 30 minutes.
          </div>
        ) : (
          <form action={requestPasswordResetAction} className="auth-form">
            <AuthField label="Email address" htmlFor="reset-email">
              <AuthInput
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </AuthField>
            <button type="submit" className="btn btn-primary btn-lg w-full">
              Email me a reset link
            </button>
          </form>
        )}
      </div>
      <p className="auth-switch">
        Remembered it? <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
