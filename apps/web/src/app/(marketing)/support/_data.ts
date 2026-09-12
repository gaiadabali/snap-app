/**
 * Support content, kept as data so the search box and the category sections
 * read from one source and can never drift apart.
 */
export type SupportIssue = {
  q: string;
  a: string;
};

export type SupportCategory = {
  id: string;
  title: string;
  intro: string;
  docsHref?: string;
  docsLabel?: string;
  issues: SupportIssue[];
};

export const CATEGORIES: SupportCategory[] = [
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
    id: 'bas-gst',
    title: 'BAS and GST questions',
    intro: 'Understanding a BAS figure, or why some GST shows as unclaimable.',
    docsHref: '/docs/bas-and-gst',
    docsLabel: 'BAS and the unclaimable-GST report',
    issues: [
      {
        q: 'Why can’t I claim the GST on this receipt?',
        a: 'You need a valid tax invoice to claim a GST credit once a purchase reaches $82.50 including GST. A receipt missing required details — often the supplier’s ABN — shows up in the unclaimable-GST report instead of label 1B.',
      },
      {
        q: 'My BAS labels look different to what my bookkeeper expects',
        a: 'Check whether your workspace is set to Simpler BAS (G1, 1A, 1B only) or the full seven-label method — this is a per-workspace setting.',
      },
      {
        q: 'The BAS report flagged its own numbers',
        a: 'The report checks 1A against roughly a tenth of G1 and 1B against roughly a tenth of reportable purchases before showing you anything — a flag here means the period is worth a closer look before lodging.',
      },
    ],
  },
  {
    id: 'xero',
    title: 'Xero connection',
    intro: 'Connecting, syncing, or disconnecting Xero.',
    docsHref: '/docs/connecting-xero',
    docsLabel: 'Connecting Xero',
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
    title: 'Billing and quota',
    intro: 'Plans, scan limits, and what happens when you reach them.',
    issues: [
      {
        q: 'I’ve hit my monthly scan quota',
        a: 'Nothing is ever dropped — the image is still stored and you’ll be offered a top-up. Extraction resumes as soon as quota is available again.',
      },
      {
        q: 'Can I change plans mid-cycle?',
        a: 'Yes — talk to Support or, on a Practice plan, your firm’s administrator.',
      },
      {
        q: 'I’m on a Practice plan — who do I contact about billing?',
        a: 'Practice billing is managed by your firm, at the firm level, not per client — contact your firm’s administrator first.',
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
        a: 'Export a tax pack — a CSV of transactions, a PDF BAS summary, and every original receipt image, foldered by quarter and category.',
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
