import { redirect } from 'next/navigation';
import { Empty } from '@/design/primitives';
import { getPlanUsage } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';
import { PlanSummary } from '../../_shell/PlanSummary';

export const metadata = { title: 'Plan & usage' };

export default async function PersonalPlanPage() {
  const { workspace } = await loadWorkspace('personal');
  // A teen's own space has no credits, plan or points of its own (group 3.10).
  if (workspace?.teenSpace === 'teen') redirect('/app');
  if (!workspace) return <Empty title="No personal workspace yet" />;
  const plan = await getPlanUsage(workspace.id);
  return <PlanSummary workspaceName={workspace.name} plan={plan} />;
}
