import Link from 'next/link';

import { ButtonLink, Card, Empty, Money, SectionTitle, Stat } from '@/design/primitives';
import { getPersonal, listDocuments } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'Overview' };

export default async function IndividualOverviewPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" body="Create one from this section to get started." />;

  const [personal, needsReview] = await Promise.all([
    getPersonal(workspace.id),
    listDocuments(workspace.id, 'needs_review'),
  ]);

  const remainingTone = Number(personal.remaining) < 0 ? 'risk' : 'good';
  const pace = Number(personal.spentThisMonth) > Number(personal.lastMonthToDate) ? 'ahead of' : 'behind';

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle as="h1" eyebrow={workspace.name} title={`${personal.monthLabel} so far`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Spent this month" value={<Money amount={personal.spentThisMonth} />} hint={`${personal.receiptCount} receipts`} />
        </Card>
        <Card>
          <Stat
            label="Left in budget"
            value={<Money amount={personal.remaining} />}
            tone={remainingTone}
            hint={
              <>
                of <Money amount={personal.budgetTotal} /> for the month
              </>
            }
          />
        </Card>
        <Card>
          <Stat
            label="Safe to spend per day"
            value={<Money amount={personal.safeToSpendPerDay} />}
            hint={`${personal.daysLeftInMonth} days left`}
          />
        </Card>
        <Card tone={needsReview.length > 0 ? 'accent' : 'surface'}>
          <Stat
            label="Needs review"
            value={needsReview.length}
            tone={needsReview.length > 0 ? 'warn' : 'neutral'}
            hint={
              needsReview.length > 0 ? (
                <Link href="/app/documents?status=needs_review" className="text-[var(--color-accent)] hover:underline">
                  Review now →
                </Link>
              ) : (
                'All caught up'
              )
            }
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">By category</h3>
            <Link href="/app/categories" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
              Manage budgets →
            </Link>
          </div>
          {personal.byCategory.length === 0 ? (
            <Empty title="No spending yet" body="Once you capture a receipt it will show up here, broken down by category." />
          ) : (
            <ul className="flex flex-col gap-3">
              {personal.byCategory.map((c) => {
                const overBudget = c.used !== null && c.used > 1;
                return (
                  <li key={c.category}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-medium text-[var(--color-ink)]">{c.category}</span>
                      <span className="text-[var(--color-ink-muted)]">
                        <Money amount={c.spent} />
                        {c.budget ? (
                          <>
                            {' '}
                            / <Money amount={c.budget} />
                          </>
                        ) : null}
                      </span>
                    </div>
                    {c.budget ? (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (c.used ?? 0) * 100)}%`,
                            background: overBudget ? 'var(--color-risk)' : 'var(--color-accent)',
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Top merchants</h3>
            <Link href="/app/analytics" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
              Full analytics →
            </Link>
          </div>
          {personal.topMerchants.length === 0 ? (
            <Empty title="Nothing yet" body="Your most-visited merchants will appear here once you have a few receipts." />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {personal.topMerchants.map((m) => (
                <li key={m.name} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--color-ink)]">{m.name}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    <Money amount={m.total} className="text-[var(--color-ink)]" /> · {m.count} receipt
                    {m.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex items-center justify-between rounded-[var(--radius-lg)] border border-dashed border-[var(--color-rule-strong)] p-5">
        <p className="text-[14px] text-[var(--color-ink-muted)]">
          Spending {pace} the same point last month (
          <Money amount={personal.lastMonthToDate} /> then vs <Money amount={personal.spentThisMonth} /> now).
        </p>
        <ButtonLink href="/app/documents" variant="secondary" size="sm">
          All documents
        </ButtonLink>
      </div>
    </div>
  );
}
