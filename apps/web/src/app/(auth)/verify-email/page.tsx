import Link from 'next/link';
import type { Metadata } from 'next';

import { authNotice } from '@/lib/auth/auth-errors';
import { confirmEmailAction } from '@/lib/auth/account-actions';

/** `no-referrer`: the URL carries a live verification token. */
export const metadata: Metadata = { title: 'Confirm your email', referrer: 'no-referrer' };

/**
 * Where the verification email's link lands (task 1.2.b).
 *
 * A button rather than confirming on page load, on purpose: mail scanners
 * fetch every link in a message, and a GET that confirmed would let a
 * scanner verify an address on behalf of whoever typed it into a sign-up
 * form — the one thing verification exists to stop.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; error?: string }>;
}) {
  const params = await searchParams;
  const notice = authNotice(params.error);
  const token = params.token ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="auth-panel">
        <div>
          <h1 className="auth-title">Confirm your email</h1>
          <p className="auth-lede">
            Confirming lets you invite people, accept invitations and link accounting software.
          </p>
        </div>

        {notice ? (
          <div role="alert" className="auth-alert auth-alert-error">
            {notice.message}
          </div>
        ) : null}

        {params.done === '1' ? (
          <div role="status" className="auth-alert auth-alert-ok">
            Your email is confirmed. You can go back to the app.
          </div>
        ) : token ? (
          <form action={confirmEmailAction} className="auth-form">
            <input type="hidden" name="token" value={token} />
            <p className="auth-lede">
              Only confirm if you created a Snap Apps account with this address. If you did not,
              close this page.
            </p>
            <button type="submit" className="btn btn-primary btn-lg w-full">
              Confirm my email
            </button>
          </form>
        ) : (
          <div className="auth-note">
            <strong>This link is incomplete.</strong>
            <p>Open the link from the email again, or ask for a new one in the app’s Settings.</p>
          </div>
        )}
      </div>
      <p className="auth-switch">
        <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
