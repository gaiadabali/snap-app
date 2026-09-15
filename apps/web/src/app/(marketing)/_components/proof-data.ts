/**
 * Testimonial content and the guard that keeps sample copy off production.
 *
 * Split out of `proof.tsx` so it is plain TypeScript with no JSX: the web test
 * suite is deliberately node-environment and logic-only (see
 * `vitest.config.ts`), so anything that needs to be *tested* has to live
 * outside the component. The guard below is exactly that kind of thing.
 *
 * ── Why the guard exists ──────────────────────────────────────────────────
 *
 * The section currently holds SAMPLE COPY so the layout can be reviewed with
 * realistic text in it. That is fine on a review host and deliberately easy to
 * see on the page. It just cannot leave one: a testimonial from a customer who
 * does not exist breaches Australian Consumer Law s29(1)(e)–(f) (false
 * representations concerning testimonials) and s18 (misleading or deceptive
 * conduct), and fake reviews are a standing ACCC enforcement priority.
 *
 * It is also specific to this product. Everything else on this site invites the
 * reader to check the claim — the comparison table is capability-only and
 * date-stamped, every figure comes from one named demo workspace, and
 * MONETISATION.md §2.1 blocks our own accuracy number until it is measured
 * against Hubdoc and Dext on the same documents. An accountant who catches one
 * fabricated quote correctly assumes the $177.15 is fabricated too.
 *
 * ── Going live ────────────────────────────────────────────────────────────
 *
 * Replace the entries with real ones and delete `placeholder`. A real entry
 * needs a named person who has actually used the product, written permission to
 * be quoted, and the quote accurate and in context. Record `consentedOn` and
 * keep the permission on file — under the ACL the burden of substantiating a
 * testimonial sits with the advertiser, not the reviewer.
 */

export type Testimonial = {
  /** Verbatim. Trim for length only, never rewrite for punch. */
  quote: string;
  name: string;
  role: string;
  location: string;
  /** Present and true while this is sample copy. Delete it for a real quote. */
  placeholder?: true;
  /** ISO date written permission was obtained. Required once real. */
  consentedOn?: string;
};

/**
 * SAMPLE COPY — not real customers.
 *
 * Written at realistic length and in the register a real one would use, because
 * a slot full of "Lorem ipsum" cannot be design-reviewed. The names are
 * deliberately generic rather than plausible-sounding individuals, so nothing
 * here reads as a real person even at a glance.
 */
export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote:
      'The mixed dockets were the thing. Half my servo stops are fuel and a coffee, and I was either claiming the GST on all of it or none of it. Now it splits them and I stop thinking about it.',
    name: 'Sample quote',
    role: 'Line-haul driver',
    location: 'Regional NSW',
    placeholder: true,
  },
  {
    quote:
      'We were spending the first week of every quarter chasing clients for tax invoices that were never valid in the first place. Seeing it flagged the day it is photographed changed what that week looks like.',
    name: 'Sample quote',
    role: 'Bookkeeping practice, 40 clients',
    location: 'Melbourne',
    placeholder: true,
  },
];

export const HAS_PLACEHOLDERS = TESTIMONIALS.some((t) => t.placeholder);

/**
 * Fails a production build while sample copy is still in place.
 *
 * Called at module scope by `proof.tsx`, so `next build` stops rather than
 * emitting a page that quietly advertises customers we do not have.
 * Overridable with `SNAP_ALLOW_PLACEHOLDER_PROOF=1` for a staging host that
 * runs with `NODE_ENV=production` — a guard against forgetting, not a lock.
 */
export function assertNoPlaceholdersInProduction(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!HAS_PLACEHOLDERS) return;
  // Bracket access on purpose. Bundlers statically substitute the dotted form
  // `process.env.NODE_ENV` for a literal before this runs, which freezes the
  // value at transform time and makes the guard impossible to test.
  if (env['NODE_ENV'] !== 'production') return;
  if (env['SNAP_ALLOW_PLACEHOLDER_PROOF'] === '1') return;
  throw new Error(
    'Refusing to build: placeholder testimonials are still present in ' +
      'src/app/(marketing)/_components/proof-data.ts. Replace them with real, consented ' +
      'quotes before a production build, or set SNAP_ALLOW_PLACEHOLDER_PROOF=1 for a ' +
      'staging host that runs with NODE_ENV=production.',
  );
}

/** The standard we set ourselves, from MONETISATION.md §2.1. */
export const MEASUREMENT = [
  {
    code: 'METRIC',
    label: 'Corrections per 100 documents',
    note: 'Not character error rate. The number that decides how long a document actually takes you.',
  },
  {
    code: 'CORPUS',
    label: 'Measured on real Australian paperwork',
    note: 'A gold set of real dockets and tax invoices — not synthetic fixtures we generated ourselves.',
  },
  {
    code: 'VS',
    label: 'Against Hubdoc and Dext, on the same documents',
    note: 'A number with no comparator is a number nobody can act on.',
  },
] as const;

export const PROOF_HEAD = {
  kicker: 'Proof',
  title: 'We would rather you checked than took our word.',
  lede: 'The free tier is the demo. Scan your own paperwork and judge it on your own dockets — then hold us to the number below.',
};
