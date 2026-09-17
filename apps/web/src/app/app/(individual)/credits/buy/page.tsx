import Link from 'next/link';

import { ArticleHero, Empty } from '@/design/primitives';
import { getCreditBalance, listCreditPacks } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

import { BuyCreditsClient } from './BuyCreditsClient';

export const metadata = { title: 'Buy credits' };

/**
 * The payment page.
 *
 * Packs and prices come from the API, which reads `credit_packs` — the same
 * rows the checkout would charge against. Nothing here computes a price and
 * nothing here hardcodes one: the marketing page quotes figures derived from
 * the same rule and `pricing/credit-packs.test.ts` fails if the two disagree,
 * because a page that advertises one price and charges another is a misleading
 * representation under ACL s18.
 */
export default async function BuyCreditsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const [packs, balance] = await Promise.all([
    listCreditPacks(workspace.id),
    getCreditBalance(workspace.id),
  ]);

  if (packs.length === 0) {
    // `<Empty>` with a real explanation rather than an empty grid — §3.5.
    return (
      <Empty
        title="No credit packs are on sale"
        body="Nothing is available to buy right now. Your existing credits are unaffected and any scans you have left still work."
        action={<Link href="/app/credits">Back to credits</Link>}
      />
    );
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-8">
      <ArticleHero
        kicker="Credits"
        title="Buy credits"
        meta="One scan costs one credit · credits never expire"
      />
      <BuyCreditsClient
        workspaceId={workspace.id}
        packs={packs}
        creditsRemaining={balance.creditsRemaining}
      />
    </div>
  );
}
