import Link from 'next/link';

import { Empty, SectionTitle, cx } from '@/design/primitives';
import { listTransactions } from '@/lib/panels/data';
import { postTransaction } from '@/lib/panels/ledger-actions';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { LedgerClient } from './LedgerClient';

export const metadata = { title: 'Ledger' };

const STATUSES = [
  { value: undefined, label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
] as const;

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const { status } = await searchParams;
  const chosen = STATUSES.find((s) => s.value === status)?.value;
  const path = `/app/business/ledger${chosen ? `?status=${chosen}` : ''}`;

  const [transactions, permissions] = await Promise.all([
    listTransactions(workspace.id, chosen as 'draft' | 'posted' | 'void' | undefined),
    getPermissions(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Ledger"
        lede="Every posting the double-entry books have accepted. Postgres refuses anything whose splits do not sum to exactly zero — this screen can only show you what already balances."
      />

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.label}
            href={`/app/business/ledger${s.value ? `?status=${s.value}` : ''}`}
            className={cx(
              'rounded-full px-3 py-1.5 text-[13px] font-semibold',
              s.value === chosen
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                : 'bg-[var(--color-surface-alt)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <LedgerClient
        transactions={transactions}
        canPost={permissions.canConfirm}
        onPost={postTransaction.bind(null, workspace.id, path)}
      />
    </div>
  );
}
