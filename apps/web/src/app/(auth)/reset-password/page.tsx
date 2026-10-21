import Link from 'next/link';
import type { Metadata } from 'next';

import { authNotice } from '@/lib/auth/auth-errors';
import { confirmPasswordResetAction } from '@/lib/auth/account-actions';

import { AuthField, AuthInput } from '../_components/ui';

/**
 * `no-referrer`: this page's URL carries a live reset token, and nothing it
 * loads should be told that URL.
 */
export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

/**
 * Where the reset email's link lands (task 1.2.a).
 *
 * Opening the page spends nothing: the token is redeemed only when the form
 * is submitted, so a mail scanner that fetches every link cannot use it up.
 * The API decides whether the token is still good; a dead one sends the
 * person back to ask for another.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const notice = authNotice(params.error);
  const token = params.token ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="auth-panel">
        <div>
          <h1 className="auth-title">Choose a new password</h1>
          <p className="auth-lede">
            At least ten characters. Saving it signs you out everywhere else, and signs you in here.
          </p>
        </div>

        {notice ? (
          <div role="alert" className="auth-alert auth-alert-error">
            {notice.message}
          </div>
        ) : null}

        {token ? (
          <form action={confirmPasswordResetAction} className="auth-form">
            <input type="hidden" name="token" value={token} />
            <AuthField label="New password" htmlFor="new-password">
              <AuthInput
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </AuthField>
            <AuthField label="The same again" htmlFor="confirm-password">
              <AuthInput
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </AuthField>
            <button type="submit" className="btn btn-primary btn-lg w-full">
              Save and sign in
            </button>
          </form>
        ) : (
          <div className="auth-note">
            <strong>This link is incomplete.</strong>
            <p>
              Open the link from the email again, or <Link href="/forgot-password">ask for a new one</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
