import type { Metadata } from 'next';

/** `no-referrer`: if the browser was sent here, the URL carries a live sign-in code. */
export const metadata: Metadata = { title: 'Open the Snap Apps app', referrer: 'no-referrer', robots: { index: false } };

/**
 * The phone app's sign-in return address. Android opens it in the app when the
 * app is installed and verified; this page only shows when it was opened in a
 * browser instead. It reads nothing from the query and never uses the code.
 */
export default function YourtalReturnPage() {
  return (
    <div className="auth-panel">
      <h1 className="auth-title">Open the Snap Apps app</h1>
      <p className="auth-lede">
        This link finishes signing in on your phone. Open the Snap Apps app and sign in with YourTal again from
        there.
      </p>
    </div>
  );
}
