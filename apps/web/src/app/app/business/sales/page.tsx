import { Card, Empty, Money, SectionTitle, Stat } from '@/design/primitives';
import { convertEstimate, recordPayment } from '@/lib/panels/business-actions';
import { getSales, listInvoices } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { SalesClient } from './SalesClient';

export const metadata = { title: 'Invoices & sales' };

export default async function SalesPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/sales';
  const [sales, invoices, permissions] = await Promise.all([
    getSales(workspace.id),
    listInvoices(workspace.id),
    getPermissions(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Invoices & sales" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Outstanding" value={<Money amount={sales.outstanding} />} />
        </Card>
        <Card>
          <Stat label="Overdue" value={<Money amount={sales.overdue} />} tone={Number(sales.overdue) > 0 ? 'risk' : 'neutral'} />
        </Card>
        <Card>
          <Stat label="Paid this quarter" value={<Money amount={sales.paidThisQuarter} />} tone="good" />
        </Card>
        <Card>
          <Stat label="GST on sales" value={<Money amount={sales.gstOnSales} />} />
        </Card>
      </div>

      <SalesClient
        invoices={invoices}
        canBill={permissions.canBill}
        onConvert={convertEstimate.bind(null, workspace.id, path)}
        onRecordPayment={recordPayment.bind(null, workspace.id, path)}
      />
    </div>
  );
}
