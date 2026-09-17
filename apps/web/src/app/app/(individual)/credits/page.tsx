import { ButtonLink, Empty, SectionTitle } from '@/design/primitives';
import { getCreditBalance, getPlanUsage, listCreditPacks, listCreditPurchases } from '@/lib/panels/data';
import { startCreditPurchase } from '@/lib/panels/credit-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { CreditsClient } from './CreditsClient';

export const metadata = { title: 'Credits' };

/**
 * Credits: bought or granted free, tenant-scoped, never reset.
 *
 * Deliberately shows the plan quota (`GET /v1/plan`, already built) ALONGSIDE
 * the credits balance (`GET /v1/credits`, new) as two separate figures
 * rather than one combined number — see `docs/ECOSYSTEM.md` D27. Conflating
 * them is how a customer ends up billed for scans they already had.
 */
export default async function CreditsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/credits';
  const [plan, balance, packs, purchases] = await Promise.all([
    getPlanUsage(workspace.id),
    getCreditBalance(workspace.id),
    listCreditPacks(workspace.id),
    listCreditPurchases(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle
          as="h1"
          title="Credits"
          lede="Scans you bought or were given for free. One scan costs one credit, and credits never expire."
        />
        <ButtonLink href="/app/credits/buy">Buy credits</ButtonLink>
      </div>
      <CreditsClient
        plan={plan}
        balance={balance}
        packs={packs}
        purchases={purchases}
        onPurchase={startCreditPurchase.bind(null, workspace.id, path)}
      />
    </div>
  );
}
