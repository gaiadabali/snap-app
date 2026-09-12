import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card } from '@/design/primitives';

import { ImpersonateForm } from '../../../_components/ImpersonateForm';
import { getUser } from '../../../_data/people';

export const metadata = { title: 'Confirm impersonation' };

/**
 * The impersonation confirmation step — docs/WEB.md §6 point 3:
 *
 *   "A confirmation step that names exactly whose financial records are
 *    about to be opened."
 *
 * Combined with the typed-reason requirement on the same screen rather than
 * a second click-through: the reason field IS the confirmation, and this
 * page's job is to make it impossible to miss whose records "confirm" opens.
 */
export default async function ImpersonateConfirmPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const user = await getUser(userId);
  if (!user) notFound();

  const primaryWorkspace = user.workspaces[0];

  return (
    <div className="mx-auto max-w-[640px] space-y-6">
      <div>
        <Badge tone="risk">Impersonation</Badge>
        <h1 className="mt-2 text-[22px] font-bold text-[var(--color-ink)]">Start an impersonation session</h1>
      </div>

      <div className="rounded-[var(--radius-lg)] border-2 border-[var(--color-risk)] bg-[var(--color-risk-soft)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-[14px] text-[var(--color-ink)]">
          You are about to open <strong>{user.displayName}</strong>'s (<span className="font-mono">{user.email}</span>)
          financial records
          {primaryWorkspace ? (
            <>
              {' '}
              in <strong>{primaryWorkspace.tenantName}</strong>
            </>
          ) : null}
          . This includes every receipt, invoice, and BAS figure they can see.
        </p>
        <ul className="mt-3 space-y-1 text-[13px] text-[var(--color-ink-muted)]">
          <li>The session lasts 15 minutes and ends itself.</li>
          <li>
            A banner naming you and <strong>{user.displayName}</strong> will follow every page until you exit.
          </li>
          <li>This event, your reason, and what you view are written to the audit trail.</li>
        </ul>
      </div>

      <Card>
        <ImpersonateForm subjectUserId={user.id} />
      </Card>

      <Link href={`/admin/people/${user.id}`} className="inline-block text-[13px] text-[var(--color-ink-muted)] hover:underline">
        ← Cancel and go back
      </Link>
    </div>
  );
}
