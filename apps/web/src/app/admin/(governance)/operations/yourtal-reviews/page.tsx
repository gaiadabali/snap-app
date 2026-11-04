import { Badge, Card, Empty, SectionTitle, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import { formatDateTime } from '../../../_components/format';
import { getYourtalReviews, type AdminYourtalReview } from '../../../_data/governance';
import { RefusalPanel } from '../../_components/RefusalPanel';
import { ResolveForm } from './_components/ResolveForm';

export const metadata = { title: 'Sign-in reviews · Snap Apps admin' };

const KIND: Record<AdminYourtalReview['kind'], { label: string; what: string }> = {
  second_sub: {
    label: 'Second YourTal account',
    what: 'A different YourTal account arrived with the email of an account that is already linked. It was refused.',
  },
  email_collision: {
    label: 'Email already used',
    what: 'A linked account’s email changed at YourTal to an address another account holds. The old email was kept.',
  },
  unlinkable_account: {
    label: 'Account cannot be linked',
    what: 'A YourTal account arrived with the email of an account that is not a kind we can link.',
  },
};

export default async function SignInReviewsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === '1';
  const reviews = await getYourtalReviews(all);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Operations"
        title="Sign in with YourTal: cases to review"
        lede="Cases the sign-in code would not decide on its own. Emails are masked here; find the people by their account ids on the People page. Resolving a case is recorded in the audit trail."
      />
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[16px] font-bold">{all ? 'All cases' : 'Open cases'}</h3>
          <a className="text-[13px] font-semibold underline" href={all ? '?' : '?all=1'}>
            {all ? 'Show open only' : 'Include resolved'}
          </a>
        </div>
        <div className="mt-4 overflow-x-auto">
          {!reviews.allowed ? (
            <RefusalPanel capability="manage_operations" status={reviews.status} message={reviews.message} />
          ) : reviews.data.length === 0 ? (
            <Empty title={all ? 'No cases yet' : 'Nothing to review'} />
          ) : (
            <Table>
              <Thead>
                <Th>Case</Th>
                <Th>Email</Th>
                <Th>Accounts</Th>
                <Th align="right">Tries</Th>
                <Th>Last seen</Th>
                <Th>Decision</Th>
              </Thead>
              <tbody>
                {reviews.data.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-semibold">{KIND[r.kind].label}</div>
                      <div className="max-w-[28ch] text-[12px] text-[var(--color-ink-muted)]">{KIND[r.kind].what}</div>
                    </Td>
                    <Td className="tabular">{r.emailMasked ?? '—'}</Td>
                    <Td className="font-mono text-[12px]">
                      {r.userId ?? '—'}
                      {r.otherUserId ? <div>{r.otherUserId}</div> : null}
                    </Td>
                    <Td align="right" className="tabular">
                      {r.attempts}
                    </Td>
                    <Td>{formatDateTime(r.lastSeenAt)}</Td>
                    <Td>
                      {r.resolvedAt ? (
                        <div>
                          <Badge tone="good">Resolved {formatDateTime(r.resolvedAt)}</Badge>
                          <div className="mt-1 text-[13px]">{r.resolution}</div>
                        </div>
                      ) : (
                        <ResolveForm id={r.id} />
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
