import Link from 'next/link';
import type { Metadata } from 'next';

import { safeReturnPath } from '@/lib/auth/safe-redirect';

export const metadata: Metadata = { title: 'This invite isn’t for you', referrer: 'no-referrer' };

/**
 * Where an adult lands after opening a teen's join link (3.10.i).
 *
 * The API signed them in as an ordinary user and left the invite pending, so
 * nothing here changes anything: it says so, then offers the two sensible
 * next steps. `next` is the page the sign-in was heading to, checked again here.
 */
export default async function InviteNotForYouPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const carryOn = safeReturnPath(next, '/app');

  return (
    <div className="flex flex-col gap-6">
      <div className="auth-panel">
        <div>
          <h1 className="auth-title">This invite isn’t for you</h1>
          <p className="auth-lede">
            This link is for a teen whose parent invited them to Snap Apps. You’ve signed in with an adult
            YourTal account, so nothing was shared. If you meant to sign up for yourself, you can carry on.
          </p>
        </div>
        <div className="auth-form">
          <Link href={carryOn} className="btn btn-primary btn-lg w-full">
            Continue to Snap Apps
          </Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="btn btn-secondary btn-lg w-full">
              Sign out
            </button>
          </form>
          <p className="auth-lede">Sign out so the right person can use the link on this device.</p>
        </div>
      </div>
    </div>
  );
}
