import { Empty } from '@/design/primitives';
import { getPlanUsage } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';
import { PlanSummary } from '../../_shell/PlanSummary';

export const metadata = { title: 'Plan & usage' };

export default async function PersonalPlanPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;
  const plan = await getPlanUsage(workspace.id);
  return <PlanSummary workspaceName={workspace.name} plan={plan} />;
}
