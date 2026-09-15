import { HouseAd } from '@/components/ads';
import { Empty, SectionTitle } from '@/design/primitives';
import { listCategorySettings } from '@/lib/panels/data';
import { createCategory, setBudget, setCategoryActive } from '@/lib/panels/category-actions';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { CategoriesTable } from './CategoriesTable';

export const metadata = { title: 'Categories & budgets' };

export default async function CategoriesPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/categories';
  const [categories, permissions] = await Promise.all([
    listCategorySettings(workspace.id),
    getPermissions(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Categories & budgets"
        lede="A monthly cap per category is what makes the overview's daily allowance meaningful. Retiring a category stops it being offered on new receipts without touching the ones that already carry it."
      />
      <CategoriesTable
        categories={categories}
        canManageBudgets={permissions.canManageBudgets}
        onToggle={setCategoryActive.bind(null, workspace.id, path)}
        onSetBudget={setBudget.bind(null, workspace.id, path)}
        onCreate={createCategory.bind(null, workspace.id, path)}
      />

      <HouseAd placement="individual-categories" />
    </div>
  );
}
