import { IconTile, Reveal, SectionHead, TextLink } from '@/design/site';
import type { IconName } from '@/design/site';

import { TrustRecord } from './trust-record';

/**
 * The page's one night section: "can I trust it".
 *
 * Silhouette: the stage on the LEFT, the argument on the right — the hero is
 * text-left / phone-right and the bento above is a full-width grid, so this is
 * the only place the picture leads. On a phone the order is heading, picture,
 * principles.
 *
 * Four principles, in plain words, each true of the shipped system. No
 * encryption specifics, no certifications, no statement of where data is
 * hosted (the privacy page owns that wording).
 */
const PRINCIPLES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'file',
    title: 'The original is never altered',
    body: 'The photo you took is kept byte for byte, for five years. That is the period the ATO asks you to keep records.',
  },
  {
    icon: 'check-circle',
    title: 'The money is exact',
    body: 'Amounts are decimal strings from end to end, never rounded through floating point. A cent out is wrong.',
  },
  {
    icon: 'shield',
    title: 'Your workspace is walled off in the database',
    body: 'Row-level security in Postgres means another account’s query cannot reach your rows. The database enforces it, not only the app.',
  },
  {
    icon: 'git-branch',
    title: 'Reading is replayable',
    body: 'Every read is versioned, so a better reader later can read your history again without touching the originals.',
  },
];

export function HomeTrust() {
  return (
    <section className="section night grain">
      <div className="shell">
        <div className="grid gap-x-16 gap-y-12 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
          <div className="lg:col-start-2 lg:row-start-1 lg:self-end">
            <SectionHead
              align="left"
              title="Your receipts are records. We keep them like records."
            />
          </div>

          <Reveal
            variant="fade"
            className="relative lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-center"
          >
            <TrustRecord />
          </Reveal>

          <div className="lg:col-start-2 lg:row-start-2">
            <ul
              className="divide-y divide-[var(--s-edge)] border-y border-[var(--s-edge)]"
              data-stagger=""
              suppressHydrationWarning
            >
              {PRINCIPLES.map((p) => (
                <li key={p.title} className="flex items-start gap-5 py-6">
                  <IconTile name={p.icon} tone="white" size={44} />
                  <div className="min-w-0">
                    <h3 className="hd-4">{p.title}</h3>
                    <p className="body mt-1.5 max-w-[46ch] !text-[var(--s-ink-2)]">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <Reveal delay={2} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
              <TextLink href="/legal/security">How we look after your data</TextLink>
              <TextLink href="/legal/privacy">Privacy</TextLink>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
