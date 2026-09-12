import { Card, Empty, Money, SectionTitle, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { listRecurring } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'Recurring' };

export default async function RecurringPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const recurring = await listRecurring(workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Recurring"
        lede="Detected from what has actually been captured — a merchant seen at a stable amount for three or more consecutive months, never a list you maintain yourself."
      />
      {recurring.length === 0 ? (
        <Empty title="Nothing recurring yet" body="Once a merchant shows up at a similar amount for a few months running, it will appear here." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Merchant</Th>
                <Th>Category</Th>
                <Th align="right">Typical amount</Th>
                <Th align="right">Months seen</Th>
                <Th>Last seen</Th>
                <Th>Next expected</Th>
                <Th align="right">Annual cost</Th>
              </Thead>
              <tbody>
                {recurring.map((r) => (
                  <Tr key={r.merchant}>
                    <Td className="font-medium">{r.merchant}</Td>
                    <Td className="text-[var(--color-ink-muted)]">{r.category}</Td>
                    <Td align="right">
                      <Money amount={r.typicalAmount} />
                    </Td>
                    <Td align="right">{r.monthsSeen}</Td>
                    <Td>{r.lastSeen}</Td>
                    <Td>{r.nextExpected}</Td>
                    <Td align="right">
                      <Money amount={r.annualCost} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
