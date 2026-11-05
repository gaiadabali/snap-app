import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Payment received', robots: { index: false } };

/**
 * Where checkout sends the customer after paying (group task 7.5). It grants
 * nothing and reads nothing: the processor's signed webhook adds the scans.
 * Public, because the phone app's browser tab is not signed in to the website.
 */
export default function CreditsThanksPage() {
  return (
    <div className="auth-panel">
      <h1 className="auth-title">Thanks, your payment went through</h1>
      <p className="auth-lede">
        Your scans are added to your account as soon as the payment is confirmed, usually within a few
        seconds. If you paid in the Snap Apps phone app, close this page to go back to it.
      </p>
      <p className="auth-switch">
        <Link href="/app/credits">See your credits</Link>
      </p>
    </div>
  );
}
