import { Empty, SectionTitle } from '@/design/primitives';
import { listDocuments } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';
import { DocumentsTable } from '../../_shell/DocumentsTable';

export const metadata = { title: 'Documents · Business' };

export default async function BusinessDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const { status } = await searchParams;
  const documents = await listDocuments(workspace.id, 'all');

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Documents"
        lede="Receipts and tax invoices captured to this business. A document without a valid tax invoice still counts as an expense — it just cannot carry a GST credit, which the BAS & GST screen totals up."
      />
      <DocumentsTable
        documents={documents}
        basePath="/app/business/documents"
        showTaxColumns
        initialStatus={(status as 'needs_review' | 'reviewed' | 'auto_accepted' | 'rejected') ?? 'all'}
      />
    </div>
  );
}
