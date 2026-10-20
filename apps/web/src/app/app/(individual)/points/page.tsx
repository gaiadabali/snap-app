import { notFound } from 'next/navigation';
import type { YourtalLinkStatus } from '@snap/api-contract';

import { Empty, SectionTitle } from '@/design/primitives';
import { getYourtalLink } from '@/lib/panels/data';
import { linkYourtal, unlinkYourtal } from '@/lib/panels/yourtal-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { config } from '@/lib/config';
import { LINK_COPY, yourtalLinks } from '@/lib/yourtal-link';
import { YourtalLinkClient } from './YourtalLinkClient';
import type { LinkLoad } from './YourtalLinkView';

export const metadata = { title: 'YourTal points' };

const PATH = '/app/points';

/**
 * Points: YourTal's, paid in YourTal (`docs/ECOSYSTEM.md` D33).
 *
 * Snap Apps used to keep its own point per scan. The founder retired that
 * (2026-10-20): YourTal points are the only points with value, so this page is
 * the link to a YourTal account and what YourTal said it paid, not a Snap Apps
 * balance. The balance itself lives in the person's YourTal wallet.
 *
 * The status comes from `GET /v1/yourtal/link`, which is USER-scoped:
 * `loadWorkspace` below is only here for the shell's own "do you have a
 * workspace at all" gate. When the server has no YourTal credentials
 * (`available: false`) the page answers 404 and the nav entry is gone
 * (`lib/panels/individual-nav.ts`): a link that cannot work is not offered.
 * A failed read is shown as an error with a retry, not as "not linked".
 */
export default async function PointsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  let status: YourtalLinkStatus | null = null;
  try {
    status = await getYourtalLink();
  } catch {
    // Shown as an error with a retry below, never as "not linked".
  }
  if (status && !status.available) notFound();
  const initial: LinkLoad = status ? { kind: 'ready', status } : { kind: 'error' };

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title={LINK_COPY.title}
        lede="Receipts you scan earn points in YourTal. They are paid there, and your balance is in your YourTal wallet."
      />
      <YourtalLinkClient
        initial={initial}
        links={yourtalLinks(config.yourtalWebUrl)}
        retryHref={PATH}
        verifyEmailHref="/verify-email"
        onLink={linkYourtal.bind(null, PATH)}
        onUnlink={unlinkYourtal.bind(null, PATH)}
      />
    </div>
  );
}
