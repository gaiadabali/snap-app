import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

/**
 * Support content, kept as data so the search box and the category sections
 * read from one source and can never drift apart.
 *
 * ── What changed on 2026-10-20, and why ───────────────────────────────────
 *
 * This list predated two decisions and contradicted the page it sits on,
 * which promises "nothing here describes a feature that isn't shipped":
 *
 * - **Credits replaced plans** (docs/WEB.md §7). "Monthly scan quota",
 *   "change plans mid-cycle" and "Practice plan" described a subscription
 *   model that no longer exists. The billing answers are rewritten from
 *   `pricing/credit-packs.ts`, the same source the pricing page uses.
 * - **The app ships as the personal release** (docs/ECOSYSTEM.md D34). The
 *   BAS report, the tax pack, Xero and practice billing are switched off in
 *   the app, and Xero sync is not built at all (docs/ROADMAP.md §3). Those
 *   answers are kept, word for word, marked `business: true`, and return when
 *   BUSINESS_SURFACES_ENABLED does — the same switch the rest of the site uses.
 */
export type SupportIssue = {
  q: string;
  a: string;
  /** Shown only while the business surfaces are on. */
  business?: true;
};

export type SupportCategory = {
  id: string;
  title: string;
  intro: string;
  docsHref?: string;
  docsLabel?: string;
  issues: SupportIssue[];
  /** Shown only while the business surfaces are on. */
  business?: true;
};

const ALL_CATEGORIES: SupportCategory[] = [
  {
    id: 'capture',
    title: 'Capture problems',
    intro: 'A scan that fails, gets rejected before upload, or looks wrong once it lands.',
    docsHref: '/docs/capturing-receipts',
    docsLabel: 'Capturing receipts well',
    issues: [
      {
        q: 'The app keeps asking me to retake the photo',
        a: 'The on-device quality check rejects a blurry shot or one that doesn’t look like a document before it ever uploads. Lay the receipt flat, avoid glare across the total, and get the whole receipt in frame.',
      },
      {
        q: 'I photographed the same receipt twice by accident',
        a: 'An exact re-upload of the same image is recognised immediately and treated as one capture, not two — you’ll be pointed at the existing record rather than getting an error.',
      },
      {
        q: 'Two of my receipts look like duplicates but aren’t',
        a: 'A same-supplier, same-amount, same-day match is only ever soft-flagged for you to check — it is never merged automatically, because two identical purchases on one day can both be real.',
      },
      {
        q: 'A multi-page invoice split into separate documents',
        a: 'Capture a multi-page tax invoice as one multi-page document rather than one photo per page, so the line items reconcile against a single total.',
      },
    ],
  },
  {
    id: 'extraction',
    title: 'Extraction accuracy and corrections',
    intro: 'A field the model got wrong, or understanding why something was flagged.',
    docsHref: '/docs/confidence-and-flags',
    docsLabel: 'Confidence and why a field was flagged',
    issues: [
      {
        q: 'A field is blank instead of filled in',
        a: 'The model is instructed to leave a field blank rather than guess when it isn’t confident — a wrong figure is worse than a missing one. Fill it in on the review screen.',
      },
      {
        q: 'I fixed a field and a later re-scan changed it back',
        a: 'This shouldn’t happen — once you correct or confirm a field it is locked against being overwritten by a machine re-run. If you’ve seen this, contact support with the document so it can be investigated.',
      },
      {
        q: 'Why did this receipt need review instead of auto-accepting?',
        a: 'The review screen shows the specific check that failed — an ABN that didn’t validate, a total that didn’t reconcile with the line items, or similar — rather than a generic low-confidence notice.',
      },
      {
        q: 'The supplier’s ABN shows as invalid but I know it’s right',
        a: 'Check for a transposed digit from the photo first — the checksum is exact. If the ABN is correct and still fails, it may have been re-typed incorrectly during capture; correct it on the review screen.',
      },
    ],
  },
  {
    // The id is kept from when this was "BAS and GST" so existing #bas-gst
    // links still land here.
    id: 'bas-gst',
    title: 'GST and tax invoices',
    intro: 'Why some GST cannot be claimed, and why one docket can carry two tax treatments.',
    issues: [
      {
        q: 'Why can’t I claim the GST on this receipt?',
        a: 'You need a valid tax invoice to claim a GST credit once a purchase reaches $82.50 including GST. A docket missing a required detail — most often the supplier’s ABN — is flagged on the receipt itself, with what to ask the supplier for.',
      },
      {
        q: 'Why are some lines on one docket GST-free?',
        a: 'Basic food such as milk, bread and eggs is GST-free; hot food, soft drinks and most other goods carry GST. Snap Apps reads each line, so a mixed docket is split into its GST-free and taxable parts instead of being treated as one taxable total.',
      },
      {
        q: 'My BAS labels look different to what my bookkeeper expects',
        a: 'Check whether your workspace is set to Simpler BAS (G1, 1A, 1B only) or the full seven-label method — this is a per-workspace setting.',
        business: true,
      },
      {
        q: 'The BAS report flagged its own numbers',
        a: 'The report checks 1A against roughly a tenth of G1 and 1B against roughly a tenth of reportable purchases before showing you anything — a flag here means the period is worth a closer look before lodging.',
        business: true,
      },
    ],
  },
  {
    id: 'xero',
    title: 'Xero connection',
    intro: 'Connecting, syncing, or disconnecting Xero.',
    docsHref: '/docs/connecting-xero',
    docsLabel: 'Connecting Xero',
    business: true,
    issues: [
      {
        q: 'A posted transaction hasn’t appeared in Xero yet',
        a: 'Xero limits how many requests can be made per minute per organisation, so pushes go through a queue. A large batch can take a short while to fully land — it hasn’t failed, it’s queued.',
      },
      {
        q: 'How do I disconnect Xero?',
        a: 'Disconnect from your workspace’s connection settings. This revokes the stored access token immediately; it doesn’t remove anything already pushed to Xero.',
      },
      {
        q: 'Do drafts sync to Xero?',
        a: 'No — only confirmed, posted transactions sync, so Xero always shows what your books show.',
      },
    ],
  },
  {
    id: 'billing',
    title: 'Credits and pricing',
    intro: 'Free scans, credits, and what a scan costs after that.',
    issues: [
      {
        q: 'What happens when my free scans run out?',
        a: `A new account starts with ${FREE_SCANS_AT_SIGNUP} free scans. After that, each scan uses one credit. Nothing is dropped when you run out — the photo is still kept, and it is read once there is a credit to read it with.`,
      },
      {
        q: 'Do credits expire?',
        a: 'No. Credits never expire and never reset, and there is no subscription — you buy a pack when you want more.',
      },
      {
        q: 'Can I buy credits yet?',
        a: 'Not yet. The checkout is not connected to a payment processor, so there is nothing to pay with today. The prices on the pricing page are the ones that will apply.',
      },
      {
        q: 'I’m on a Practice plan — who do I contact about billing?',
        a: 'Practice billing is managed by your firm, at the firm level, not per client — contact your firm’s administrator first.',
        business: true,
      },
    ],
  },
  {
    id: 'data',
    title: 'Data export and retention',
    intro: 'Getting your data out, and how long it’s kept.',
    docsHref: '/docs/data-retention',
    docsLabel: 'Data retention and deletion',
    issues: [
      {
        q: 'How do I get everything for my accountant?',
        a: BUSINESS_SURFACES_ENABLED
          ? 'Export a tax pack — a CSV of transactions, a PDF BAS summary, and every original receipt image, foldered by quarter and category.'
          : 'Export your receipts as CSV from the Spending screen — one row per receipt, or one row per line item. The original photos stay in the app for the full five years.',
      },
      {
        q: 'How long is my data kept?',
        a: 'Five years from when a record was prepared or its transaction completed, matching ATO requirements, then it’s removed by an automated purge.',
      },
      {
        q: 'Can I delete my account?',
        a: 'Yes, through Support. Records still inside their mandatory five-year window are closed out of active use but can’t be deleted until that window passes.',
      },
    ],
  },
];

/** What the page shows: business content only while the business surfaces are on. */
export const CATEGORIES: SupportCategory[] = ALL_CATEGORIES.filter(
  (c) => BUSINESS_SURFACES_ENABLED || !c.business,
).map((c) => ({
  ...c,
  issues: c.issues.filter((i) => BUSINESS_SURFACES_ENABLED || !i.business),
}));

export type SearchableTopic = {
  category: string;
  categoryHref: string;
  q: string;
  a: string;
};

export const SEARCH_INDEX: SearchableTopic[] = CATEGORIES.flatMap((category) =>
  category.issues.map((issue) => ({
    category: category.title,
    categoryHref: `#${category.id}`,
    q: issue.q,
    a: issue.a,
  })),
);
