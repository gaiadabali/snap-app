import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Delete your account',
  description:
    'How to delete your Snap Apps account from the app, how to ask us to do it by email, and what is deleted and what is kept.',
};

/** The mailbox for deletion requests and the store listing (group 0.12.c: hansel@gaiada.com until a support mailbox exists). */
const REQUEST_EMAIL = 'hansel@gaiada.com';
const REQUEST_MAILTO = `mailto:${REQUEST_EMAIL}?subject=${encodeURIComponent('Delete my Snap Apps account')}`;

/**
 * The public page Google Play's listing links to, so it needs no sign-in and no script.
 * What is deleted and kept follows yourtal docs/29 §8 (founder Q1, Q2, Q4); the phone's
 * Delete account screen says the same (apps/mobile/src/components/DeleteAccountPanel.tsx).
 */
export default function DeleteAccountPage() {
  return (
    <div className="shell-narrow pt-12 pb-20 sm:pt-16 sm:pb-28">
      <h1 className="hd-1">Delete your Snap Apps account</h1>
      <p className="lede mt-6">
        You can delete your account yourself in the app, or ask us to do it by email. Either way your
        sign-in and the workspaces you run on your own are erased, receipts included.
      </p>

      <section aria-labelledby="in-app" className="mt-12">
        <h2 id="in-app" className="hd-3">
          Delete it in the app
        </h2>
        <ol className="body mt-4 list-decimal space-y-2 pl-6">
          <li>Open Snap Apps on your phone and sign in.</li>
          <li>
            Go to <strong>Settings</strong> and choose <strong>Delete account</strong>, near the
            bottom.
          </li>
          <li>
            Read what will be deleted, type <strong>DELETE</strong>
            {' '}(and your password, if your account has one), then confirm.
          </li>
        </ol>
        <p className="body mt-4">
          You are signed out on every device straight away. The erasure itself usually runs within minutes.
        </p>
      </section>

      <section aria-labelledby="by-email" className="mt-12">
        <h2 id="by-email" className="hd-3">
          Or ask us by email
        </h2>
        <p className="body mt-4">
          Can&apos;t get into the app? Email{' '}
          <a className="font-semibold text-[var(--s-blue-text)] underline" href={REQUEST_MAILTO}>
            {REQUEST_EMAIL}
          </a>{' '}
          from the address your account uses, with the subject &ldquo;Delete my Snap Apps
          account&rdquo;. We reply to confirm it is you, then delete the account the same way the app
          does. If you write from a different address, tell us the one on the account so we can
          check.
        </p>
      </section>

      <section aria-labelledby="deleted" className="mt-12">
        <h2 id="deleted" className="hd-3">
          What is deleted
        </h2>
        <ul className="body mt-4 list-disc space-y-2 pl-6">
          <li>Your account, your sign-in and every session on every device.</li>
          <li>
            Every workspace that only you run, with its receipts and the original images, invoices,
            ledgers, statements, goals and credits. This includes receipts the ATO would want you to
            keep for five years: <strong>export what you need first</strong>, because we cannot get
            it back afterwards.
          </li>
          <li>Your YourTal points history in Snap Apps, and the emails we kept a record of sending you.</li>
        </ul>
      </section>

      <section aria-labelledby="kept" className="mt-12">
        <h2 id="kept" className="hd-3">
          What stays
        </h2>
        <ul className="body mt-4 list-disc space-y-2 pl-6">
          <li>
            <strong>Shared workspaces</strong> keep their records, because they belong to the
            business. Your name is removed from them. If you were the only owner, the longest-serving
            manager becomes the owner; if there is no manager, the workspace is deleted and its
            members are emailed.
          </li>
          <li>
            A log of what our staff did to accounts (who and when, not your receipts). It is
            append-only.
          </li>
          <li>
            Backup copies, until they age out. We do not restore an account that has been deleted.
          </li>
        </ul>
      </section>

      <section aria-labelledby="yourtal" className="mt-12">
        <h2 id="yourtal" className="hd-3">
          If you sign in with YourTal
        </h2>
        <p className="body mt-4">
          Deleting your Snap Apps account does <strong>not</strong> delete your YourTal account, and
          YourTal keeps its own records. To remove Snap Apps from your YourTal account, go to{' '}
          <strong>Me, then Linked apps</strong> in YourTal. If you delete your YourTal account,
          YourTal tells Snap Apps, and we delete everything described above within 3 days.
        </p>
      </section>

      <p className="body mt-12">
        Questions? See the <a className="underline" href="/support">help centre</a> or our{' '}
        <a className="underline" href="/legal/privacy">privacy policy</a>.
      </p>
    </div>
  );
}
