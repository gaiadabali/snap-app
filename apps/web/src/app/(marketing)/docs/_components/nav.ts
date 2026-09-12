/**
 * The docs sidebar, in reading order.
 *
 * One list, used by the sidebar nav and by the docs index page. Add a page by
 * adding a row here and a `page.tsx` at the matching path — nothing else
 * needs to know about it.
 */
export type DocsNavItem = {
  href: string;
  title: string;
  summary: string;
};

export const DOCS_NAV: DocsNavItem[] = [
  {
    href: '/docs/getting-started',
    title: 'Getting started',
    summary: 'What Snap Apps does, and the shortest path from install to your first posted transaction.',
  },
  {
    href: '/docs/capturing-receipts',
    title: 'Capturing receipts well',
    summary: 'What makes a scan easy to read automatically, and what causes a re-take.',
  },
  {
    href: '/docs/reviewing-corrections',
    title: 'Reviewing and correcting extractions',
    summary: 'How the review screen works, and why your correction always wins.',
  },
  {
    href: '/docs/confidence-and-flags',
    title: 'Confidence and why a field was flagged',
    summary: 'What the confidence score means and the checks that run behind it.',
  },
  {
    href: '/docs/ledger-and-posted',
    title: 'The ledger and what "posted" means',
    summary: 'Double-entry basics, drafts versus posted transactions, and why the books always balance.',
  },
  {
    href: '/docs/bas-and-gst',
    title: 'BAS and the unclaimable-GST report',
    summary: 'Simpler BAS versus the full method, and why some GST cannot be claimed.',
  },
  {
    href: '/docs/tax-pack',
    title: 'The tax pack',
    summary: 'What is in the export your accountant actually wants, and how to send it.',
  },
  {
    href: '/docs/connecting-xero',
    title: 'Connecting Xero',
    summary: 'What syncs, what does not yet, and how to disconnect.',
  },
  {
    href: '/docs/data-retention',
    title: 'Data retention and deletion',
    summary: 'How long records are kept, why, and how to ask for deletion.',
  },
];
