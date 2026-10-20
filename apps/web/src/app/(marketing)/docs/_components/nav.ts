import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

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
  /** The sidebar and hub group this article sits under. */
  group: DocsGroup;
  /**
   * A guide to a business surface (docs/ECOSYSTEM.md D34). Listed only while
   * BUSINESS_SURFACES_ENABLED is on — the BAS report and the tax pack are
   * switched off in the app, and Xero sync is not built (docs/ROADMAP.md §3).
   * The page itself still renders at its URL; it is just not advertised.
   */
  business?: true;
};

export type DocsGroup = 'Start here' | 'Review and trust' | 'Books and tax' | 'Your data';

const ALL_DOCS: DocsNavItem[] = [
  {
    href: '/docs/getting-started',
    group: 'Start here',
    title: 'Getting started',
    summary: 'What Snap Apps does, and the shortest path from install to your first posted transaction.',
  },
  {
    href: '/docs/capturing-receipts',
    group: 'Start here',
    title: 'Capturing receipts well',
    summary: 'What makes a scan easy to read automatically, and what causes a re-take.',
  },
  {
    href: '/docs/reviewing-corrections',
    group: 'Review and trust',
    title: 'Reviewing and correcting extractions',
    summary: 'How the review screen works, and why your correction always wins.',
  },
  {
    href: '/docs/confidence-and-flags',
    group: 'Review and trust',
    title: 'Confidence and why a field was flagged',
    summary: 'What the confidence score means and the checks that run behind it.',
  },
  {
    href: '/docs/ledger-and-posted',
    group: 'Books and tax',
    title: 'The ledger and what "posted" means',
    summary: 'Double-entry basics, drafts versus posted transactions, and why the books always balance.',
  },
  {
    href: '/docs/bas-and-gst',
    group: 'Books and tax',
    business: true,
    title: 'BAS and the unclaimable-GST report',
    summary: 'Simpler BAS versus the full method, and why some GST cannot be claimed.',
  },
  {
    href: '/docs/tax-pack',
    group: 'Books and tax',
    business: true,
    title: 'The tax pack',
    summary: 'What is in the export your accountant actually wants, and how to send it.',
  },
  {
    href: '/docs/connecting-xero',
    group: 'Books and tax',
    business: true,
    title: 'Connecting Xero',
    summary: 'What syncs, what does not yet, and how to disconnect.',
  },
  {
    href: '/docs/data-retention',
    group: 'Your data',
    title: 'Data retention and deletion',
    summary: 'How long records are kept, why, and how to ask for deletion.',
  },
];

/** Items of one group, in reading order. */
/** The guides a reader can browse to: business guides only while that switch is on. */
export const DOCS_NAV: DocsNavItem[] = ALL_DOCS.filter((d) => BUSINESS_SURFACES_ENABLED || !d.business);

/** Groups in reading order, skipping any left empty by the filter above. */
export const DOCS_GROUPS: DocsGroup[] = (
  ['Start here', 'Review and trust', 'Books and tax', 'Your data'] as const
).filter((g) => DOCS_NAV.some((d) => d.group === g));

export function docsInGroup(group: DocsGroup): DocsNavItem[] {
  return DOCS_NAV.filter((item) => item.group === group);
}
