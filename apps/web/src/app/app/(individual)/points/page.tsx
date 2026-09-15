import { Card, Empty, SectionTitle, Stat, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { getPointBalance, listPointLedger } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'Points' };

const REASON_LABEL: Record<string, string> = {
  scan: 'Scan',
  signup: 'Welcome bonus',
  referral: 'Referral',
  redemption: 'Redeemed',
  adjustment: 'Adjustment',
};

/**
 * Points: earned by scanning, USER-scoped rather than tied to any one
 * workspace — `docs/ECOSYSTEM.md` D27. Still rendered inside the personal
 * panel shell (`loadWorkspace` below is only here for the shell's own
 * "do you have a workspace at all" gate); the balance and ledger themselves
 * come from `/v1/points` and `/v1/points/ledger`, neither of which is asked
 * for a workspace id.
 *
 * There is no redemption control on this page, on purpose: redemption
 * happens in yourtal, which does not exist yet. Saying so plainly is the
 * honest version of this screen, not a "coming soon" placeholder.
 */
export default async function PointsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const [{ balance }, ledger] = await Promise.all([getPointBalance(), listPointLedger(100)]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Points"
        lede="One point for every scan you complete — yours, wherever you sign in across the ecosystem, not tied to this workspace."
      />

      <Card tone="accent" className="max-w-[320px]">
        <Stat label="Balance" value={balance} hint="Never expires." />
      </Card>

      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] p-4 text-[13px] text-[var(--color-ink-muted)]">
        Points are spent in <span className="font-medium text-[var(--color-ink)]">yourtal</span>, a
        separate app in the ecosystem that has not been built yet. There is nothing to redeem here —
        this page only tracks what you have earned.
      </div>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">How you earned them</h2>
        {ledger.length === 0 ? (
          <Empty title="No points yet" body="Confirm a scan and your first point will show up here." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
            <Table>
              <Thead>
                <Th>Date</Th>
                <Th>Reason</Th>
                <Th align="right">Points</Th>
              </Thead>
              <tbody>
                {ledger.map((entry) => (
                  <Tr key={entry.id}>
                    <Td>{entry.createdAt.slice(0, 10)}</Td>
                    <Td>{REASON_LABEL[entry.reason] ?? entry.reason}</Td>
                    <Td align="right" className={entry.delta < 0 ? 'text-[var(--color-risk)]' : undefined}>
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
