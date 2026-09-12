import { Empty, SectionTitle } from '@/design/primitives';
import { payBill } from '@/lib/panels/business-actions';
import { listBills } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { BillsClient } from './BillsClient';

export const metadata = { title: 'Bills' };

export default async function BillsPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/bills';
  const [bills, permissions] = await Promise.all([listBills(workspace.id), getPermissions(workspace.id)]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Bills" lede="Money owed to suppliers, by due date. A part payment is ordinary — pay what's agreed and the rest stays owing." />
      <BillsClient bills={bills} canPay={permissions.canBill} onPay={payBill.bind(null, workspace.id, path)} />
    </div>
  );
}
