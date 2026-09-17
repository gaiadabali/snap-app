import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Container, Rule, Section, SectionHead } from '@/design/primitives';
import { Scene } from '@/design/three/Scene';
import { DESIGN_LAB_ENABLED } from '@/lib/features';

import { ReceiptScanCard } from '../../_components/receipt-scan-card';

/**
 * Phase 0 of the 3D direction: ONE scene, looked at before anything else is
 * built on top of it.
 *
 * `docs/DESIGN-HANDOFF.md` §12.1 is the reason this is a route and not a
 * commit against the home page. Three directions have already been taken all
 * the way to a rendered page and all three were rejected as generated-looking,
 * two of them having drifted onto near-black-plus-bright-accent without anyone
 * choosing it. The cheapest way not to be the fourth is to make the thing
 * cheap to throw away.
 *
 * So: the scene at the size it would actually run, the flat card it replaces
 * shown beside it rather than described, and enough page underneath to scroll
 * the camera through its whole range. Judge it here. If it is not obviously
 * better than the card on the right, the answer is that the card wins and this
 * directory gets deleted.
 */

export const metadata: Metadata = {
  title: 'Capture chamber — 3D spike',
  robots: { index: false, follow: false },
};

export default function CaptureLabPage() {
  if (!DESIGN_LAB_ENABLED) notFound();

  return (
    <>
      <Section code="S1" size="lg">
        <SectionHead
          kicker="Phase 0 · scene 1 of 7"
          title="The capture chamber"
          lede="One docket, lit like a photographed object, being read. The sweep runs on a 2.6s loop — the same rhythm as the flat .scan-line — and scroll drives the camera through depth rather than driving the read."
        />
      </Section>

      {/* The scene at working size. Portrait, because a docket is. */}
      <Section code="LIVE" size="lg" form="wide">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-start">
          <div>
            <div className="t-label mb-4 text-[var(--color-ink-faint)]">WebGL</div>
            <Scene className="mx-auto aspect-[3/4] w-full max-w-[460px]">
              {/*
                The twin. It is the accessible copy and it is what sets the
                canvas's height, so it stays in the DOM — faded out once the
                first frame lands, never unmounted.
              */}
              <div className="flex h-full items-center justify-center">
                <ReceiptScanCard className="w-full" scanning={false} />
              </div>
            </Scene>
          </div>

          <div>
            <div className="t-label mb-4 text-[var(--color-ink-faint)]">
              What ships today — the twin, unmodified
            </div>
            <ReceiptScanCard className="w-full" />
          </div>
        </div>
      </Section>

      <Section code="?" form="measure" size="lg">
        <Rule />
        <h2 className="t-head mt-8">What to look for</h2>
        <ul className="t-body mt-6 space-y-4 text-[var(--color-ink-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">Does it read as photographed?</strong> The
            test is the 30° lens and the saddle curl. If it reads as a flat rectangle with a
            gradient on it, the direction has failed and no amount of further scenes fixes that.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Are the boxes on the text?</strong> They are
            placed by <code className="font-mono text-[13px]">measureText</code>, from the same code
            that drew the type, so they should be exact at every zoom. A box that floats off its
            line discredits the one claim the product makes.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Toggle the theme.</strong> The docket is
            redrawn in the theme&apos;s own ink on the theme&apos;s own paper. Nothing in{' '}
            <code className="font-mono text-[13px]">src/design/three</code> contains a hex literal —
            every colour comes back out of <code className="font-mono text-[13px]">globals.css</code>
            , so it cannot drift from the measured identity or from the mobile app.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Scroll, then move the pointer.</strong> The
            sheet turns to face you as the section takes the viewport; the pointer adds about two
            degrees on top. That parallax is most of the difference between a render on a page and
            an object on a desk.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Then turn motion off</strong> — OS-level
            reduce-motion, or DevTools&apos; emulation. The canvas must never mount and the card on
            the left must be fully legible. Same for a browser with WebGL disabled.
          </li>
        </ul>
      </Section>

      {/* Runway, so the camera's scroll range can actually be exercised. */}
      <Section size="lg" form="wide">
        <Container width="wide">
          <div className="h-[60vh]" />
        </Container>
      </Section>
    </>
  );
}
