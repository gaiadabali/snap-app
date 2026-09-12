import { Empty, SectionTitle } from '@/design/primitives';
import { countStock, createItem } from '@/lib/panels/business-actions';
import { listItems, listStockMovements } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { StockClient } from './StockClient';

export const metadata = { title: 'Stock' };

export default async function StockPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/stock';
  const [items, movements, permissions] = await Promise.all([
    listItems(workspace.id),
    listStockMovements(workspace.id),
    getPermissions(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Stock" lede="A count is recorded as a movement carrying the difference — never an overwrite, so the record shows how far out the shelf was, not just the new number." />
      <StockClient
        items={items}
        movements={movements}
        canManage={permissions.canBill}
        onCreate={createItem.bind(null, workspace.id, path)}
        onCount={countStock.bind(null, workspace.id, path)}
      />
    </div>
  );
}
