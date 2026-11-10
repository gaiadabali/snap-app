import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Empty } from '@/design/primitives';
import { getCreditDocument } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

import { PrintButton } from './PrintButton';

export const metadata = { title: 'Receipt' };

/**
 * A receipt, tax invoice, adjustment note or refund receipt for a credit
 * purchase (7.7.b), laid out to print. Every word comes from the server
 * (`GET /v1/credits/documents/:id`), so this page cannot show an ABN or a GST
 * line the document does not carry: it prints what it is given.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const doc = await getCreditDocument(workspace.id, id).catch(() => null);
  if (!doc) notFound();

  return (
    <div className="flex flex-col gap-4">
      {/* Print only the document: drop the site header and side navigation. */}
      <style>{`@media print { header, aside, .receipt-actions { display: none !important; } main { padding: 0 !important; } }`}</style>
      <div className="receipt-actions flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/credits" className="text-[13px] font-semibold text-[var(--color-accent-strong)] hover:underline">
          Back to credits
        </Link>
        <PrintButton />
      </div>

      <article
        aria-label={`${doc.title} ${doc.number}`}
        className="mx-auto w-full max-w-[720px] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-8 text-[14px] text-[var(--color-ink)] print:border-0 print:p-0"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold">{doc.title}</h1>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              No. {doc.number} · {doc.issuedOn}
            </p>
            {doc.reference ? <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{doc.reference}</p> : null}
          </div>
          {doc.issuer ? (
            <div className="text-right text-[13px]">
              <div className="font-semibold">{doc.issuer.legalName}</div>
              {doc.issuer.abn ? <div>ABN {doc.issuer.abn}</div> : null}
              <div className="whitespace-pre-line">{doc.issuer.address}</div>
              <div>{doc.issuer.email}</div>
            </div>
          ) : (
            <div className="text-right text-[13px] font-semibold">Snap Apps</div>
          )}
        </header>

        <section className="mt-6 text-[13px]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">Billed to</div>
          <div className="mt-1 font-semibold">{doc.buyer.name}</div>
          {doc.buyer.email ? <div>{doc.buyer.email}</div> : null}
        </section>

        <table className="mt-6 w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[var(--color-rule)] text-left text-[12px] uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
              <th className="py-2 font-semibold">Item</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Price</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-rule)]">
              <td className="py-3">{doc.item.description}</td>
              <td className="py-3 text-right">{doc.item.quantity}</td>
              <td className="py-3 text-right">{doc.item.amount}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1">
          <div className="text-[16px] font-bold">Total {doc.total}</div>
          {doc.gstStatement ? <div className="text-[13px]">{doc.gstStatement}</div> : null}
        </div>

        {doc.note ? <p className="mt-6 text-[13px] text-[var(--color-ink-muted)]">{doc.note}</p> : null}
      </article>
    </div>
  );
}
