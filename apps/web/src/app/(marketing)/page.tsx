import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ArrowLink,
  ButtonLink,
  Container,
  Join,
  LedgerRow,
  Money,
  Reveal,
  Rule,
  Section,
  SectionHead,
} from '@/design/primitives';
import { Scene } from '@/design/three/Scene';
import { BUSINESS_SURFACES_ENABLED, SCENES_3D_ENABLED } from '@/lib/features';

import { AppScreens } from './_components/app-showcase';
import { ReceiptScanCard } from './_components/receipt-scan-card';
import { ComparisonTable } from './_components/comparison';
import { PageSpine } from './_components/page-spine';
import { GetTheAppButtons } from './_components/platform-cta';
import {
  CREDIT_PACKS,
  CREDIT_PRICE_AUD,
  FREE_SCANS_AT_SIGNUP,
} from './pricing/credit-packs';
import { ReadComparison } from './_components/read-comparison';
import { ScanBed } from './_components/scan-bed';
import { Proof, PROOF_HEAD } from './_components/proof';

export const metadata: Metadata = {
  title: 'Split every receipt correctly — GST, BAS and deductions for Australian trades',
  description:
    'Half a docket can have GST and half can be GST-free. Snap Apps reads every line, splits the tax correctly, and gives you a BAS position you can defend. Ten scans free, then pay per scan.',
};

/**
 * The home page.
 *
 * Its job is conversion, not credibility theatre: get a sole trader to install
 * the app, and get a practice to look at pricing. An earlier revision led with
 * the pipeline architecture (`captures` → `extraction_runs` → …), which
 * `docs/MONETISATION.md` §2.1 explicitly calls "procurement words for a buyer
 * we are not selling to". That material now lives on /how-it-works, where
 * someone already sold is going to look for it.
 *
 * Two ordering rules came straight out of MONETISATION.md:
 *
 * 1. **Per-category tax subtotals leads.** §2 calls it "the single capability
 *    no competitor at any price currently offers" and warns against burying it
 *    in paragraph four. It is now the headline and the first section.
 * 2. **Both doors are visible above the fold.** Practices are the revenue
 *    ($19/client/month, one sales motion) and sole traders are the funnel
 *    (free tier). A homepage that only speaks to one loses the other.
 *
 * Every figure on this page comes from ONE worked case — K. Marsh Transport,
 * the demo workspace the app screenshots are captured from. A page that quotes
 * four unrelated made-up numbers reads as invented; a page that follows one
 * business through a quarter reads as a product someone actually built.
 */

/** A mixed servo docket. GST-free groceries and taxable hot food on one receipt. */
const DOCKET = [
  { label: 'Milk 2L', amount: '4.50', taxable: false },
  { label: 'Bread', amount: '3.80', taxable: false },
  { label: 'Fresh sandwich', amount: '8.50', taxable: false },
  { label: 'Hot pie', amount: '6.20', taxable: true },
  { label: 'Soft drink 1.25L', amount: '3.20', taxable: true },
  { label: 'Coffee', amount: '6.00', taxable: true },
] as const;

/**
 * The six documents flagged in the demo quarter. Totals are the receipt
 * amounts; GST at risk across all six is $177.15, which is the figure the
 * app's own Tax & BAS screen shows in the screenshot further up the page.
 */
const FLAGGED = [
  { name: 'Beaurepaires Orange', amount: '1848.00', reason: 'No supplier ABN on the invoice' },
  { name: 'Coin Laundry Parkes', amount: '12.00', reason: 'Not a tax invoice — no GST breakdown' },
  { name: 'Roadside Coffee Van', amount: '8.50', reason: 'ABN fails the mod-89 checksum' },
] as const;

const DEDUCTIONS = [
  { code: 'D1', label: 'Work-related car and truck expenses', amount: '21,480.00' },
  { code: 'D2', label: 'Travel — accommodation and meals away', amount: '18,905.00' },
  { code: 'D3', label: 'Clothing, laundry and dry-cleaning', amount: '1,240.00' },
  { code: 'D5', label: 'Other work-related expenses — tools, phone', amount: '8,945.00' },
] as const;

const PRACTICE_QUEUE = [
  {
    client: 'K. Marsh Transport',
    state: '6 receipts missing a valid tax invoice',
    figure: '6 to review',
    tone: 'risk',
  },
  {
    client: 'Baird & Sons Plumbing',
    state: 'One fuel claim awaiting a tax invoice',
    figure: '1 to review',
    tone: 'warn',
  },
  {
    client: 'Coastline Carpentry',
    state: 'All 84 documents validated · G11 reconciled',
    figure: 'Ready',
    tone: 'good',
  },
] as const;

/** 0.033 -> "3.3". The unit price is a headline figure, so it is written out. */
const HOME_CENTS_PER_SCAN = (CREDIT_PRICE_AUD * 100).toFixed(1);

/** The two doors. Equal weight, because the business has two buyers. */
function Door({
  kicker,
  title,
  price,
  note,
  href,
  cta,
}: {
  kicker: string;
  title: string;
  price: string;
  note: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className={[
        'group flex flex-col justify-between gap-6 rounded-[var(--radius-md)] border p-6',
        'border-[var(--color-rule-strong)] bg-[var(--color-ground)]',
        'transition-colors duration-200 hover:border-[var(--color-accent)]',
      ].join(' ')}
    >
      <div>
        <div className="t-label text-[var(--color-ink-faint)]">{kicker}</div>
        <div className="mt-3 text-[19px] leading-snug text-[var(--color-ink)]">{title}</div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-mono text-[26px] tabular text-[var(--color-ink)]">{price}</span>
          <span className="text-[13px] text-[var(--color-ink-muted)]">{note}</span>
        </div>
      </div>
      <span className="inline-flex items-center gap-2 text-[14px] font-medium text-[var(--color-accent)]">
        {cta}
        <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
          &rarr;
        </span>
      </span>
    </Link>
  );
}

export default function HomePage() {
  return (
    <>
      {/* The bed the document lies on — a ruled feed, an irregular column
          field, a scale down the right margin and one travelling light, all
          driven by the document's own scroll. First in the fragment because it
          is `z-index: -1`: it has to be behind everything, and being first is
          the cheapest way to say so. See `_components/scan-bed.tsx`. */}
      <ScanBed />

      {/* The reading rail — the page's only progress indicator now that the
          header's has gone. See `_components/page-spine.tsx`. */}
      <PageSpine />

      {/* ── Hero ─────────────────────────────────────────────────────────
          The wedge as the headline, both doors above the fold, and the docket
          itself as the artefact.

          It used to be a phone screenshot here. The four real app screens are
          still on this page, two sections down, which is where proof belongs —
          the hero's job is the CLAIM, and the claim is about what happens to a
          piece of paper. §12.2 permits exactly two kinds of imagery: the app
          screenshots, and the document itself. This is the second one. */}
      <div className="pin-track first-screen">
      <section className="screen sect-3d">
        <Container width="wide" className="pb-16 pt-14 md:pb-20 md:pt-20">
          {/**
           * Three children, explicitly placed, so the phone can sit in
           * different places on the two layouts.
           *
           * On a handset the source order wins: headline → phone → doors. The
           * app has to be visible before the reader is asked to choose a door,
           * because "show me the thing" is the whole job of this page and
           * burying it under both CTAs is exactly backwards on the surface
           * where most of this traffic lands.
           *
           * From `lg` the phone moves to its own column and spans both rows,
           * putting the copy and the doors back in one stack beside it.
           */}
          <div className="grid gap-10 lg:grid-cols-[1.06fr_0.94fr] lg:items-center lg:gap-14">
            <div className="lg:col-start-1 lg:row-start-1">
              <div className="anim-load t-label text-[var(--color-ink-muted)]">
                GST · BAS · deductions — built for Australian trades
              </div>

              <h1 className="t-display anim-load mt-6 max-w-[15ch]" style={{ ['--i' as string]: 1 }}>
                Half this docket has GST.{' '}
                <span className="text-[var(--color-accent)]">Half doesn&apos;t.</span>
              </h1>

              <p
                className="t-lede anim-load mt-7 max-w-[48ch] text-[var(--color-ink-muted)]"
                style={{ ['--i' as string]: 2 }}
              >
                Every other scanner reads one total and hopes. Snap Apps reads every line, splits
                the tax correctly, and hands you a BAS position you can actually defend — on the
                fresh sandwich and the hot pie from the same servo receipt.
              </p>
            </div>

            <div
              className="anim-load lg:col-start-2 lg:row-start-1 lg:row-span-2"
              style={{ ['--i' as string]: 3 }}
            >
              {/*
                The scene, given a caption and a rule to stand on.

                It used to end in mid-air: a 460px frame with a docket floating
                in it and three hundred pixels of nothing underneath, against a
                left column that ran all the way down. A figure with a caption
                is an object on a page; the same figure without one is a hole
                the layout failed to fill. The caption also says what is being
                looked at, which the frame alone never did.

                Nothing in it is a figure. Every number the docket carries is
                in `ReceiptScanCard` below — which stays in the DOM even once
                the canvas covers it — so this stays a label, and docs/WEB.md
                §4.4's rule that a scene may never be the only place a figure
                exists is not quietly worked around by putting the figures in
                the caption instead.
              */}
              <figure className="mx-auto w-full max-w-[340px] lg:max-w-[440px]">
                <Scene
                  enabled={SCENES_3D_ENABLED}
                  className="hero-scene aspect-[3/4] w-full"
                >
                  <div className="flex h-full items-center justify-center">
                    <ReceiptScanCard className="w-full" scanning={false} />
                  </div>
                </Scene>
                <figcaption className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[var(--color-rule)] pt-3">
                  <span className="t-label text-[var(--color-ink-faint)]">
                    Capture · demo workspace
                  </span>
                  <span className="font-mono text-[11px] tabular text-[var(--color-ink-muted)]">
                    Three lines read · ABN checked · posted
                  </span>
                </figcaption>
              </figure>
            </div>

            {/*
              Two doors — sole trader and practice — when both audiences are
              sold (docs/MONETISATION.md §3). BUSINESS_SURFACES_ENABLED is
              off (`src/lib/features.ts`), so this is one door at full width
              rather than a two-column grid with an empty second cell —
              "gap-toothed" is the thing docs/WEB.md §3.5 rules out.
            */}
            <div
              className={
                BUSINESS_SURFACES_ENABLED
                  ? 'anim-load grid gap-4 sm:grid-cols-2 lg:col-start-1 lg:row-start-2'
                  : 'anim-load flex flex-col gap-8 lg:col-start-1 lg:row-start-2'
              }
              style={{ ['--i' as string]: 4 }}
            >
              {/*
                The app itself, first. This is a landing page for a phone app
                and until now it had no way to GET the phone app — both doors
                led to a web sign-up, and `/download` was reachable only from
                the nav. Someone who arrives convinced should be able to
                install it from the screen that convinced them.

                Order is deliberate: install, then sign up. The free tier
                needs no card and the app is what was just demonstrated, so
                asking for an account before handing over the thing is the
                wrong way round.
              */}
              <GetTheAppButtons />

              {BUSINESS_SURFACES_ENABLED ? (
                <>
                  <Door
                    kicker="Start free, no card"
                    title="Sole trader, tradie, or on the road"
                    price="Free"
                    note="10 free scans"
                    href="/register"
                    cta="Start scanning"
                  />
                  <Door
                    kicker="I look after clients"
                    title="Accounting or bookkeeping practice"
                    price="$19"
                    note="per client / month"
                    href="/pricing#practice"
                    cta="See practice pricing"
                  />
                </>
              ) : (
                /*
                 * The one door, as a ruled line rather than a fourth box.
                 *
                 * With BUSINESS_SURFACES_ENABLED off there is no second door
                 * to sit beside, so the `Door` card was a full-width panel
                 * holding four short strings — and it landed under the two
                 * platform badges, which are themselves boxes, under a
                 * headline, under a lede. Four stacked rectangles of falling
                 * size is the metronome docs/DESIGN-HANDOFF.md §12.1 rejected
                 * three directions over, and this stylesheet states the
                 * alternative in its own opening comment: "a ruled book, not a
                 * stack of boxes".
                 *
                 * So the same facts are set as a ledger line — audience,
                 * price, what happens after the free ten — which is both the
                 * page's native form and MORE information than the card
                 * carried, since the per-scan price now appears beside the
                 * word "free" instead of only behind a link.
                 *
                 * `Door` is untouched and still used above. Flipping the flag
                 * restores the two-card hero exactly as it was.
                 */
                <div>
                  <div className="t-label text-[var(--color-ink-faint)]">
                    Start free, no card — sole trader, tradie, or on the road
                  </div>

                  {/*
                    `animate={false}` on both, and it is not a style call.

                    `Rule` draws itself with `.anim-rule`, which inside a
                    `.pin-track` is scrubbed by the track's own timeline over
                    30–46%. The hero is the FIRST screen, and its track already
                    reads about 38% at scroll zero — so a scroll-driven rule in
                    this section greets every visitor half drawn and stays that
                    way until they scroll. Measured on the live page: the strip
                    rendered with a stub of rule about 190px long under a line
                    of type running the full column.

                    Everything above the fold has to arrive on a CLOCK, which
                    is what `.anim-load` on the wrapper already does. That is
                    the same reason the hero's other blocks use it.
                  */}
                  <div className="mt-4">
                    <Rule tone="strong" animate={false} />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-2 py-4">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-[30px] leading-none tabular text-[var(--color-ink)]">
                          Free
                        </span>
                        <span className="text-[14px] text-[var(--color-ink-muted)]">
                          first {FREE_SCANS_AT_SIGNUP} scans
                        </span>
                      </div>
                      <span className="font-mono text-[13px] tabular text-[var(--color-ink-muted)]">
                        then {HOME_CENTS_PER_SCAN}c a scan · no subscription
                      </span>
                    </div>
                    <Rule animate={false} />
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
                    <ButtonLink href="/register" size="lg">
                      Start scanning
                    </ButtonLink>
                    <ArrowLink href="/pricing">What a scan costs after the first ten</ArrowLink>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Container>
      </section>
      </div>

      {/* ── The wedge, first and shown ───────────────────────────────────
          MONETISATION.md §2: "not a schema detail to mention in paragraph
          four". So it is section one. */}
      <Join />

      <div className="pin-track">
      <Section code="G11" className="screen sect-3d">
        <SectionHead
          kicker="The thing no other app does"
          title="One receipt. Two tax answers. Split to the cent."
          lede="Buy milk, bread and a sandwich with a hot pie and a coffee, and you have bought two different tax treatments on one docket. A tool that only reads the total has to guess which half is which — and a guess is not a BAS position."
        />

        {/*
          The docket coming apart along the tax boundary.

          The scene and the ledger beneath it are the same six lines and the
          same two subtotals — 4.50 + 3.80 + 8.50 = 16.80 GST-free, and
          6.20 + 3.20 + 6.00 = 15.40 taxable carrying 1.40 of GST. The 3D is a
          camera on the rows below it, never a second set of figures.
        */}
        {/*
          Scene and answers side by side, filling the screen this section owns.

          They were stacked — scene centred, figures underneath — and that left
          a void down the left third while the heading above it was flush left.
          A centred object under left-aligned type reads as two layouts, not
          one. Side by side, the docket comes apart and the two subtotals it
          resolves into sit level with it, which is also the order the claim is
          made in.
        */}
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_0.6fr] lg:items-center lg:gap-14">
          <Scene
            scene="split"
            enabled={SCENES_3D_ENABLED}
            /*
              `min-w-0` is load-bearing. A grid item defaults to
              `min-width: auto`, so it refuses to shrink below its content and
              silently widens its track instead — this one blew out to 662px
              inside a 390px viewport and gave the whole document a horizontal
              scrollbar. The `Split` primitive already guards every track this
              way; a hand-rolled grid has to do it too.
            */
            className="aspect-[16/10] w-full min-w-0"
          >
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-[420px]">
                <div className="t-label text-[var(--color-ink-faint)]">
                  Coles Express Yass · 11 Sep 2026
                </div>
                <div className="mt-5">
                  <Rule />
                  {DOCKET.map((line, i) => (
                    <LedgerRow
                      key={line.label}
                      index={i}
                      code={line.taxable ? 'TAX' : 'FREE'}
                      label={line.label}
                      value={<Money amount={line.amount} />}
                    />
                  ))}
                  {/*
                    The docket total belongs here even though the section makes
                    its point with the two subtotals beside it. The scene prints
                    32.20 on the paper, and docs/WEB.md §4.4 states the rule: a
                    scene may not be the only place a figure exists. Caught by
                    asserting every figure the scenes depict is also in the DOM.
                  */}
                  <div className="mt-1 flex items-baseline justify-between gap-4 border-t-2 border-[var(--color-ink)] pt-4">
                    <span className="text-[14px] text-[var(--color-ink)]">Docket total</span>
                    <Money
                      amount="32.20"
                      className="font-mono text-[18px] text-[var(--color-ink)]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Scene>

          <div className="flex min-w-0 flex-col gap-10">
            <Reveal>
              <div>
                <div className="t-label text-[var(--color-good)]">GST-free</div>
                <div className="anim-strike mt-3 font-mono text-[clamp(2rem,3.4vw,2.9rem)] font-normal leading-none tabular text-[var(--color-good)]">
                  <Money amount="16.80" />
                </div>
                <p className="mt-3 max-w-[30ch] text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  Basic food. No GST to claim, and none claimed.
                </p>
              </div>
            </Reveal>

            <Rule />

            <Reveal delay={1}>
              <div>
                <div className="t-label text-[var(--color-accent)]">Taxable · GST $1.40</div>
                <div className="anim-strike mt-3 font-mono text-[clamp(2rem,3.4vw,2.9rem)] font-normal leading-none tabular text-[var(--color-accent)]">
                  <Money amount="15.40" />
                </div>
                <p className="mt-3 max-w-[30ch] text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  Hot food and drinks. Reconciled per line, not per receipt.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Section>
      </div>

      {/* ── The app itself ──────────────────────────────────────────────── */}
      {/* `inline` — no head. The section above ended on two figures; this one
          answers "what does that look like in my hand" and opening it with
          another rule/kicker/display stack would be the fourth identical
          opening in a row. That repetition, not the palette, is what got three
          directions rejected (§12.1). */}
      <Join />

      <div className="pin-track">
      <Section code="THE APP" form="wide" size="sm" className="screen sect-3d">
        <div className="seam" aria-hidden />
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3">
          <div className="t-label text-[var(--color-ink-faint)]">
            Real screens · demo workspace
          </div>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
            Photograph it, check what was read, move on. The app tells you what needs a human and
            leaves everything else alone.
          </p>
        </div>
        {/* Capped so three phones fit the screen this section owns. Without
            it the grid sizes to the image aspect and overruns by ~50px, which
            is just enough to stop the section being one screen. */}
        <div className="app-deck mt-10 [&_figure]:mx-auto lg:[&_figure]:max-w-[292px]">
          <AppScreens />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <ButtonLink href="/download" size="lg">
            Download the app
          </ButtonLink>
          <ArrowLink href="/how-it-works">How a receipt moves through it</ArrowLink>
        </div>
      </Section>
      </div>

      {/* ── Comparison ──────────────────────────────────────────────────── */}
      {/* The demonstration: one docket, read four ways. */}
      <Join />

      <div className="pin-track">
      <Section code="VS" className="screen sect-3d">
        <SectionHead
          kicker="Against what you are probably using"
          title="The row nobody else can tick."
        />
        <div className="mt-10">
          <ReadComparison />
        </div>
      </Section>
      </div>

      {/* The evidence, kept as a table because that is what evidence looks
          like — named, date-stamped and checkable. `wide` so it does not share
          a silhouette with the demonstration above it. */}
      <Join />

      <div className="pin-track">
      <Section code="MATRIX" form="wide" className="screen sect-3d">
        <div className="seam" aria-hidden />
        <div className="mt-6 t-label text-[var(--color-ink-faint)]">
          Capability, not quality — every cell is checkable
        </div>
        {/* The table is evidence, so it stays a table — it is not replaced by
            a scene. It just arrives like one. */}
        <div className="pop-3d mt-12">
          <ComparisonTable />
        </div>
      </Section>
      </div>

      {/* ── Proof ───────────────────────────────────────────────────────
          Currently sample copy plus the things a reader can verify today.
          See _components/proof.tsx — it will not build for production while
          the samples are still in. */}
      {/* Was `measure`. It stopped being a prose section when the three
          measurements became a 3-up: a 68ch column squeezed them to ~208px
          each on a 2000px screen and left the right half of the page empty.
          The gutter form gives them ~340px and puts the ATO code back in the
          margin where every other section keeps it. */}
      <Join />

      <div className="pin-track">
      <Section code="CHECK" className="screen sect-3d">
        <SectionHead
          kicker={PROOF_HEAD.kicker}
          title={PROOF_HEAD.title}
          lede={PROOF_HEAD.lede}
        />
        <div className="mt-12">
          <Proof />
        </div>
      </Section>
      </div>

      {/* ── The inverted band ────────────────────────────────────────────
          One dark moment, on the sharpest number, tied to the same worked
          case as the app screenshots above. */}
      {/* `wide` — the form the handoff reserves for "the single most important
          claim", and this is it. It also keeps the void band from sharing a
          silhouette with the deduction ledger immediately below it. */}
      <Join />

      <div className="pin-track">
      <Section code="1B" tone="void" size="lg" form="wide" className="screen sect-3d">
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <Reveal variant="expand">
            <div className="t-label text-[var(--color-void-muted)]">
              GST credits at risk — this quarter
            </div>

            {/* The sharpest number on the page, and the only one that gets
                this treatment. `.anim-strike` brings it forward out of the
                void rather than wiping it in flat — the whole section exists
                to make this figure land. */}
            <div className="anim-strike mt-5">
              <div className="font-mono text-[clamp(3.25rem,8vw,6rem)] font-normal leading-none tabular text-[var(--color-risk)]">
                <Money amount="177.15" />
              </div>
            </div>

            <p className="t-lede mt-7 max-w-[42ch] text-[var(--color-void-ink)]">
              of GST this business cannot legally claim, on six documents out of eighty. Not because
              the money was not spent — because the paperwork is not a valid tax invoice.
            </p>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-void-muted)]">
              You find this out in one of two ways. Either the app flags it the day you scan it,
              while the supplier will still reissue the docket — or the ATO finds it, and by then
              nobody is reissuing anything.
            </p>
          </Reveal>

          <div className="lg:pt-2">
            <div className="t-label text-[var(--color-void-muted)]">Flagged at capture</div>
            <div className="mt-5">
              <Rule tone="void" />
              {FLAGGED.map((r, i) => (
                <LedgerRow
                  key={r.name}
                  tone="void"
                  index={i}
                  label={r.name}
                  note={r.reason}
                  value={<Money amount={r.amount} className="text-[var(--color-risk)]" />}
                />
              ))}
              <LedgerRow
                tone="void"
                index={3}
                label="…and three more this quarter"
                note="Each one caught the day it was photographed"
                value={<span className="text-[var(--color-void-muted)]">—</span>}
              />
            </div>

            <Reveal>
              <div className="mt-10 border-t border-[var(--color-void-rule)] pt-6">
                <div className="t-label text-[var(--color-good)]">
                  Claimable, same quarter · label 1B
                </div>
                <div className="anim-strike mt-3 font-mono text-[40px] font-normal leading-none tabular text-[var(--color-good)]">
                  <Money amount="1476.70" />
                </div>
                <p className="mt-3 max-w-[38ch] text-[13.5px] leading-relaxed text-[var(--color-void-muted)]">
                  Backed by valid tax invoices — every element the ATO requires, present and
                  checked.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Section>
      </div>

      {/* ── Deductions ──────────────────────────────────────────────────── */}
      <Join />

      <div className="pin-track">
      <Section code="D1–D5" className="screen sect-3d">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <SectionHead
              kicker="Built for 1 July"
              title="Scan all year. The return is already written."
              lede="Snap Apps knows what a line-haul driver can claim that a sparky cannot. Every scan is tagged against its ATO deduction label as it is captured — not reconstructed from a shoebox in June."
            />
            <div className="mt-10">
              <ArrowLink href="/features#tax-pack">See the tax pack</ArrowLink>
            </div>
          </div>

          <div>
            <div className="t-label text-[var(--color-ink-faint)]">
              K. Marsh Transport · line haul / interstate · FY2025–26
            </div>
            <div className="mt-5">
              <Rule tone="strong" />
              {DEDUCTIONS.map((d, i) => (
                <LedgerRow
                  key={d.code}
                  index={i}
                  code={d.code}
                  label={d.label}
                  value={<Money amount={d.amount} />}
                />
              ))}
            </div>
            <Reveal>
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t-2 border-[var(--color-ink)] pt-5">
                <span className="text-[15px] text-[var(--color-ink)]">Estimated deduction</span>
                <span className="anim-strike inline-block font-mono text-[28px] font-normal tabular text-[var(--color-accent)]">
                  <Money amount="50570.00" />
                </span>
              </div>
              <p className="mt-3 text-[13px] text-[var(--color-ink-muted)]">
                Typical for this occupation: $40,000–$55,000. An estimate outside the band is the
                first thing your accountant should see.
              </p>
            </Reveal>
          </div>
        </div>
      </Section>
      </div>

      {/* ── Practices ───────────────────────────────────────────────────── *
       * Whole section hidden while BUSINESS_SURFACES_ENABLED is false — this
       * IS the business/practice surface `docs/MONETISATION.md` §3 calls the
       * primary revenue line. Left in the source rather than deleted so
       * flipping the flag back on restores it exactly as it was. */}
      {BUSINESS_SURFACES_ENABLED ? (
      <>
      <Join />

      <div className="pin-track">
      <Section code="FIRMS" className="screen sect-3d">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div>
            <SectionHead
              kicker="For accounting &amp; bookkeeping practices"
              title="Fewer minutes per document. Across every client."
              lede="Onboard a client base, not one user at a time. Xero sync posts into the chart of accounts you already run, and every scan a client takes rolls up into one firm-wide review queue."
            />
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <ButtonLink href="/pricing#practice" size="lg">
                See practice pricing
              </ButtonLink>
              <ArrowLink href="/support">Talk to us</ArrowLink>
            </div>
          </div>

          <div className="lg:pt-8">
            <div className="t-label text-[var(--color-ink-faint)]">
              BAS review queue · Q1 FY2026–27
            </div>
            <div className="mt-5">
              <Rule tone="strong" />
              {PRACTICE_QUEUE.map((c, i) => (
                <LedgerRow
                  key={c.client}
                  index={i}
                  label={c.client}
                  note={c.state}
                  value={
                    <span
                      className={
                        c.tone === 'risk'
                          ? 'text-[var(--color-risk)]'
                          : c.tone === 'good'
                            ? 'text-[var(--color-good)]'
                            : 'text-[var(--color-warn)]'
                      }
                    >
                      {c.figure}
                    </span>
                  }
                />
              ))}
            </div>
            <Reveal>
              <p className="mt-6 max-w-[40ch] text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Sorted by what needs a human, not alphabetically. A client whose receipts all
                validated never reaches this list.
              </p>
            </Reveal>
          </div>
        </div>
      </Section>
      </div>
      </>
      ) : null}

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <Join />

      <div className="pin-track">
      <Section code="CREDIT" form="wide" className="screen sect-3d">
        <div className="seam" aria-hidden />
        <SectionHead
          kicker="Pricing"
          title="Ten scans free. Then you pay per scan."
          // Trimmed. This used to run "No subscription, no seats, no monthly
          // allowance to run out of" — which is the same triple negative the
          // column beside the ledger now makes concretely, against figures the
          // reader can check. Saying it twice in one screen, once vaguely and
          // once with evidence, only weakens the evidence.
          lede="One scan costs one credit, and credits do not expire."
          className="mt-6"
        />

        {/*
          ── The price list, as a price list ──────────────────────────────

          This was two bordered cards side by side, and three things about it
          did not survive being looked at.

          1. **The left card was mostly empty.** It held a label, the figure
             10, two sentences and a button, in a `justify-between` column
             stretched to match a neighbour carrying six ledger rows. About
             two hundred pixels of nothing sat between the paragraph and the
             button — not restraint, just a box that had been asked to be as
             tall as the box next to it.

          2. **The rows read as disabled.** `LedgerRow` staggers its arrival
             by `--i`, and with six rows the last one did not finish until 68%
             of the pinned track — the exact moment the section releases. So
             at any ordinary scroll position the bottom of the list was
             half-faded, and a half-faded row in a PRICE LIST does not say
             "arriving", it says "unavailable". The tier you most want to sell
             looked greyed out. Fixed with `.ledger-tight` in globals.css,
             which compresses the stagger into the held window; the list still
             deals in, it just finishes while it can be read.

          3. **It said "free" for the third time.** The hero says it, this
             section's own `title` says it, and then a card said it again with
             a border around it.

          What replaces them is the thing this actually is: one ruled price
          list, in the idiom the rest of the site is built in — the stylesheet
          opens by calling it "a ruled book, not a stack of boxes". The free
          ten are its first row, because that is what they are, and the packs
          follow under their own sub-label so "first 10 scans, free" and
          "10 scans, $0.33" cannot be read as contradicting each other.

          It also lets the page finally say the interesting thing, which the
          two cards had no room for: every pack is the same rate. `packPrice`
          is `credits × CREDIT_PRICE_AUD` with no volume curve, so that claim
          is arithmetic the reader can check against the column above it
          rather than a promise. Nothing here is hardcoded — the figures still
          come from `pricing/credit-packs`, so this cannot quote a price the
          checkout would not honour.
        */}
        <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          {/* Capped. At the full track width a row ran 655px between "1,000 scans"
                and "$33.00", which is a long way to carry the eye across nothing —
                the ledger rows elsewhere on this page have a `note` filling that
                span and these do not. */}
          <div className="ledger-tight min-w-0 lg:max-w-[30rem]">
            <div className="t-label text-[var(--color-ink-faint)]">What a scan costs</div>

            <div className="mt-5">
              <Rule tone="strong" />
              <LedgerRow
                index={0}
                emphasis
                label={`Your first ${FREE_SCANS_AT_SIGNUP} scans`}
                note="On signup. No card, and nothing that recurs."
                value={<span className="text-[var(--color-good)]">Free</span>}
              />
            </div>

            <div className="mt-6 t-label text-[var(--color-ink-faint)]">Top up, any time</div>
            <div className="mt-3">
              <Rule />
              {CREDIT_PACKS.map((pack, i) => (
                <LedgerRow
                  key={pack.credits}
                  label={`${pack.credits.toLocaleString('en-AU')} scans`}
                  value={<Money amount={pack.priceAud} />}
                  index={i + 1}
                />
              ))}
              <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--color-ink)] pt-4">
                <span className="text-[14px] text-[var(--color-ink)]">Every pack, same rate</span>
                <span className="font-mono text-[18px] tabular text-[var(--color-accent)]">
                  {HOME_CENTS_PER_SCAN}c a scan
                </span>
              </div>
            </div>
          </div>

          <div className="min-w-0 lg:pt-10">
            <Reveal>
              <p className="t-lede max-w-[40ch] text-[var(--color-ink-muted)]">
                Buying a thousand does not make a scan any cheaper than buying fifty. There is no
                volume tier to negotiate, no plan to be moved onto, and no month in which unused
                credits disappear.
              </p>
            </Reveal>

            <Reveal delay={1}>
              <p className="mt-5 max-w-[40ch] text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
                The free ten are enough to photograph a week of receipts and judge it on your own
                paperwork — which is the only test that settles it.
              </p>
            </Reveal>

            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <ButtonLink href="/register" size="lg">
                Start scanning
              </ButtonLink>
              <ArrowLink href="/pricing">Why that price, and what a credit buys</ArrowLink>
            </div>
          </div>
        </div>
      </Section>
      </div>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-[var(--color-rule)]">
        <Container width="wide" className="flex flex-col items-center py-24 text-center md:py-32">
          <Reveal>
            <h2 className="t-head max-w-[18ch]">Start with the next receipt in your pocket.</h2>
          </Reveal>
          <Reveal>
            <p className="t-lede mt-6 max-w-[46ch] text-[var(--color-ink-muted)]">
              Ten scans free, no card. You will know by the third one whether it reads your
              dockets properly.
            </p>
          </Reveal>
          <Reveal>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <ButtonLink href="/register" size="lg">
                Start scanning free
              </ButtonLink>
              <ButtonLink href="/download" size="lg" variant="secondary">
                Download the app
              </ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
