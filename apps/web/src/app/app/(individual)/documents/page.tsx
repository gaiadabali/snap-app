import { HouseAd } from '@/components/ads';
import { Empty, SectionTitle } from '@/design/primitives';
import { listDocuments } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';
import { DocumentsTable } from '../../_shell/DocumentsTable';

export const metadata = { title: 'Documents' };

export default async function IndividualDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const { status } = await searchParams;
  const documents = await listDocuments(workspace.id, 'all');

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Documents"
        lede="Every receipt captured to this household, searchable and filterable. Open one to correct anything the scan got wrong."
      />
      <DocumentsTable
        documents={documents}
        basePath="/app/documents"
        showTaxColumns={false}
        initialStatus={(status as 'needs_review' | 'reviewed' | 'auto_accepted' | 'rejected') ?? 'all'}
      />

      <HouseAd placement="individual-documents" />
    </div>
  );
}
