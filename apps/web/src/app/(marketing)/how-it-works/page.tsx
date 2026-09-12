import type { Metadata } from 'next';

import { Badge, ButtonLink, Card, Container, SectionTitle } from '@/design/primitives';

import { ReceiptScanCard } from '../_components/receipt-scan-card';
import { CameraIcon, FolderCheckIcon, LayersIcon, ScaleIcon } from '../_components/icons';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'The four-layer pipeline behind every scan: capture, extraction run, document, transaction — explained for a human, not an engineer.',
};

const STEPS = [
  {
    icon: CameraIcon,
    tag: 'Capture',
    title: 'You photograph the receipt',
    body: (
      <>
        The camera checks focus and framing before it lets you upload — a blurry photo of a
        crumpled receipt gets rejected on the spot, not three steps later. What gets stored is the
        original image, untouched, forever. That's the copy that counts as evidence if the ATO ever
        asks; a separate, lightly processed copy is what the model actually reads.
      </>
    ),
    example: 'A photo of an Ironbark Trade Supplies invoice, taken at 7:41am on-site.',
  },
  {
    icon: LayersIcon,
    tag: 'Extraction run',
    title: 'A model reads it — and the read is versioned',
    body: (
      <>
        Claude reads every field off the image — supplier, ABN, line items, GST — and attaches a
        confidence score to each one. It's told explicitly: if it isn't sure, say so, don't guess.
        Nine arithmetic and ATO-rule checks run immediately after. Anything uncertain, or anything
        that fails a check, gets a second, stronger read automatically. This whole attempt is saved
        as a numbered "run" — it's never edited in place, only ever superseded.
      </>
    ),
    example:
      'Run #1 reads the ABN as 84 731 502 664 (confidence 0.99), the GST as $7.50, and passes all nine validators on the first attempt.',
  },
  {
    icon: FolderCheckIcon,
    tag: 'Document',
    title: 'The best run becomes the record',
    body: (
      <>
        The winning run's fields become the document you actually see — supplier, amounts, and a
        plain yes/no: is this a valid tax invoice? That verdict is what decides whether its GST can
        legally be claimed, and it's set by the validators, not by whether the total looked right at
        a glance. If a later model re-reads the same image and does better, a new run is added and
        the document quietly points at it — nothing about the old read is destroyed.
      </>
    ),
    example: '"Ironbark Trade Supplies, $82.50, is_tax_invoice: true" — ready to become a transaction.',
  },
  {
    icon: ScaleIcon,
    tag: 'Transaction',
    title: 'A balanced ledger entry is proposed',
    body: (
      <>
        The document becomes a draft double-entry transaction — an expense split, a GST split, a
        payment-method split — with the right BAS label already attached. You review and post it, or
        it auto-posts if everything is high-confidence and clean. Once posted, it's locked: a later
        re-extraction can't silently rewrite a number that's already on your BAS. It raises a review
        task instead, and a human decides.
      </>
    ),
    example: 'Motor Vehicle expense +$75.00, GST Receivable +$7.50, Credit Card −$82.50, tax code GST (G11 · 1B).',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <Badge tone="accent">The pipeline</Badge>
          <h1 className="mt-4 max-w-[40ch] text-[34px] font-bold leading-[1.15] text-[var(--color-ink)] sm:text-[42px]">
            One receipt, four layers, none of them destructive.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
            Capture, extraction run, document, transaction. Each is its own database record, so
            nothing has to be re-photographed and nothing gets silently overwritten — including six
            months from now, when the model reading your receipts is better than the one that read
            them today.
          </p>
        </Container>
      </section>

      <section className="border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <Container width="wide" className="py-16">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <SectionTitle
                eyebrow="Follow one receipt"
                title="An $82.50 invoice from a hardware supplier"
                lede="The same example moves through every step on this page, ending as a posted, BAS-labelled ledger entry."
              />
              <ReceiptScanCard className="mt-8 w-full max-w-[360px]" />
            </div>

            <ol className="flex flex-col gap-6">
              {STEPS.map((step, i) => (
                <li key={step.tag}>
                  <Card className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-mono text-[14px] font-bold text-[var(--color-accent)]">
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                          <step.icon className="h-4 w-4" />
                          {step.tag}
                        </div>
                        <h3 className="mt-1 text-[18px] font-bold text-[var(--color-ink)]">{step.title}</h3>
                        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
                          {step.body}
                        </p>
                        <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-ink-faint)]">
                            In this example
                          </div>
                          <p className="mt-1 font-mono text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                            {step.example}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      <section className="border-b border-[var(--color-rule)]">
        <Container width="wide" className="py-16">
          <SectionTitle eyebrow="Questions people actually ask" title="Why build it this way" />
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-[15px] font-bold text-[var(--color-ink)]">
                Why keep the original photo forever?
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                The ATO accepts an electronic copy only where it's a true and clear reproduction of
                the original. A recompressed or edited image isn't that. The original never changes;
                only a derived copy is used for reading.
              </p>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--color-ink)]">
                Why is a "run" a separate thing from the document?
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                Extraction quality moves with the model, not with your data. Keeping runs versioned
                means a stronger model next year can re-read your entire history, and you can see
                exactly what changed and why — never a silent correction.
              </p>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--color-ink)]">
                What happens when a validator fails?
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                It escalates to a stronger model first. If it still fails, the document is marked{' '}
                <Badge tone="warn">needs review</Badge> with the specific check named — never
                posted as a guess.
              </p>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--color-ink)]">
                Can a re-extraction change a number already on my BAS?
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                No. A posted transaction is locked. A better read of the same receipt raises a review
                task for a human to apply — it never rewrites a lodged figure on its own.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section>
        <Container width="wide" className="flex flex-col items-center gap-5 py-20 text-center">
          <h2 className="max-w-[36ch] text-[26px] font-bold leading-tight text-[var(--color-ink)]">
            See everything this pipeline produces
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/features" size="lg">
              Explore features
            </ButtonLink>
            <ButtonLink href="/register" size="lg" variant="secondary">
              Get started free
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
