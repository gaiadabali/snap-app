import { HouseAd } from '@/components/ads';
import { Empty, SectionTitle } from '@/design/primitives';
import { listGoals } from '@/lib/panels/data';
import { contributeToGoal, createGoal, deleteGoal } from '@/lib/panels/goal-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { GoalsClient } from './GoalsClient';

export const metadata = { title: 'Goals' };

export default async function GoalsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/goals';
  const goals = await listGoals(workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Goals" lede="Savings goals sit alongside your everyday spending — contributing to one doesn't remove the money from anywhere else, it's simply tracked." />
      <GoalsClient
        goals={goals}
        onCreate={createGoal.bind(null, workspace.id, path)}
        onContribute={contributeToGoal.bind(null, workspace.id, path)}
        onDelete={deleteGoal.bind(null, workspace.id, path)}
      />

      <HouseAd placement="individual-goals" />
    </div>
  );
}
