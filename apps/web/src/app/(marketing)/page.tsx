import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ArrowLink,
  ButtonLink,
  Container,
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
import { Proof, PROOF_HEAD } from './_components/proof';

export const metadata: Metadata = {
  title: 'Split every receipt correctly — GST, BAS and deductions for Australian trades',
  description:
    'Half a docket can have GST and half can be GST-free. Snap Apps reads every line, splits the tax correctly, and gives you a BAS position you can defend. Free for 20 receipts a month.',
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

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    unit: 'forever',
    line: '20 receipts a month, 12-month retention. No card.',
    href: '/register',
    cta: 'Start scanning',
    primary: false,
  },
  {
    name: 'Sole Trader',
    price: '$29',
    unit: 'per month, incl GST',
    line: '150 receipts, realtime, BAS pack, Xero sync, 5-year retention.',
    href: '/pricing',
    cta: 'See what is included',
    primary: true,
  },
  // The Practice door is folded back in the moment BUSINESS_SURFACES_ENABLED
  // flips true — see src/lib/features.ts. Kept in the source, filtered at
  // render, so re-enabling needs no rewrite.
  {
    name: 'Practice',
    price: '$19',
    unit: 'per client / month',
    line: 'From 10 clients. 200 scans each, firm-wide BAS review queue.',
    href: '/pricing#practice',
    cta: 'See practice pricing',
    primary: false,
    businessOnly: true,
  },
] as const;

const VISIBLE_PLANS = PLANS.filter((p) => !('businessOnly' in p) || BUSINESS_SURFACES_ENABLED);

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
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16">
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
              <Scene
                enabled={SCENES_3D_ENABLED}
                className="mx-auto aspect-[3/4] w-full max-w-[340px] lg:max-w-[460px]"
              >
                <div className="flex h-full items-center justify-center">
                  <ReceiptScanCard className="w-full" scanning={false} />
                </div>
              </Scene>
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
                  : 'anim-load flex flex-col gap-5 lg:col-start-1 lg:row-start-2'
              }
              style={{ ['--i' as string]: 4 }}
            >
              <Door
                kicker="Start free, no card"
                title="Sole trader, tradie, or on the road"
                price="Free"
                note="20 receipts a month"
                href="/register"
                cta="Start scanning"
              />
              {BUSINESS_SURFACES_ENABLED ? (
                <Door
                  kicker="I look after clients"
                  title="Accounting or bookkeeping practice"
                  price="$19"
                  note="per client / month"
                  href="/pricing#practice"
                  cta="See practice pricing"
                />
              ) : (
                <ArrowLink href="/pricing">See what Sole Trader unlocks — realtime, BAS pack, Xero sync</ArrowLink>
              )}
            </div>
          </div>
        </Container>
      </section>

      {/* ── The wedge, first and shown ───────────────────────────────────
          MONETISATION.md §2: "not a schema detail to mention in paragraph
          four". So it is section one. */}
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

      {/* ── The app itself ──────────────────────────────────────────────── */}
      {/* `inline` — no head. The section above ended on two figures; this one
          answers "what does that look like in my hand" and opening it with
          another rule/kicker/display stack would be the fourth identical
          opening in a row. That repetition, not the palette, is what got three
          directions rejected (§12.1). */}
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
        <div className="mt-10 [&_figure]:mx-auto lg:[&_figure]:max-w-[292px]">
          <AppScreens />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <ButtonLink href="/download" size="lg">
            Download the app
          </ButtonLink>
          <ArrowLink href="/how-it-works">How a receipt moves through it</ArrowLink>
        </div>
      </Section>

      {/* ── Comparison ──────────────────────────────────────────────────── */}
      <Section code="VS" className="screen sect-3d">
        <SectionHead
          kicker="Against what you are probably using"
          title="The row nobody else can tick."
        />
        <div className="mt-12">
          <ComparisonTable />
        </div>
      </Section>

      {/* ── Proof ───────────────────────────────────────────────────────
          Currently sample copy plus the things a reader can verify today.
          See _components/proof.tsx — it will not build for production while
          the samples are still in. */}
      {/* `measure` — one 68ch column. The only section on the page shaped
          like prose, because it is the only one doing any. */}
      <Section code="CHECK" form="measure" className="screen sect-3d">
        <SectionHead
          kicker={PROOF_HEAD.kicker}
          title={PROOF_HEAD.title}
          lede={PROOF_HEAD.lede}
        />
        <div className="mt-12">
          <Proof />
        </div>
      </Section>

      {/* ── The inverted band ────────────────────────────────────────────
          One dark moment, on the sharpest number, tied to the same worked
          case as the app screenshots above. */}
      {/* `wide` — the form the handoff reserves for "the single most important
          claim", and this is it. It also keeps the void band from sharing a
          silhouette with the deduction ledger immediately below it. */}
      <Section code="1B" tone="void" size="lg" form="wide" className="screen sect-3d">
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <Reveal variant="expand">
            <div className="t-label text-[var(--color-void-muted)]">
              GST credits at risk — this quarter
            </div>

            <div className="anim-wipe mt-5">
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
                <div className="mt-3 font-mono text-[40px] font-normal leading-none tabular text-[var(--color-good)]">
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

      {/* ── Deductions ──────────────────────────────────────────────────── */}
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
                <span className="font-mono text-[28px] font-normal tabular text-[var(--color-accent)]">
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

      {/* ── Practices ───────────────────────────────────────────────────── *
       * Whole section hidden while BUSINESS_SURFACES_ENABLED is false — this
       * IS the business/practice surface `docs/MONETISATION.md` §3 calls the
       * primary revenue line. Left in the source rather than deleted so
       * flipping the flag back on restores it exactly as it was. */}
      {BUSINESS_SURFACES_ENABLED ? (
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
      ) : null}

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <Section code="PLANS" form="wide" className="screen sect-3d">
        <div className="seam" aria-hidden />
        <SectionHead
          kicker="Pricing"
          title="Start free. Bring your accountant when you are ready."
          lede="No trial clock and no card on the free tier — it is a real plan, not a countdown."
          className="mt-6"
        />
        <div
          className={
            VISIBLE_PLANS.length === 3
              ? 'mt-12 grid gap-6 md:grid-cols-3'
              : 'mt-12 grid gap-6 sm:grid-cols-2 md:mx-auto md:max-w-[720px]'
          }
        >
          {VISIBLE_PLANS.map((plan, i) => (
            <Reveal key={plan.name} variant="deal" delay={i}>
              <div
                className={[
                  'flex h-full flex-col justify-between gap-8 rounded-[var(--radius-md)] border p-6',
                  plan.primary
                    ? 'border-[var(--color-accent)] bg-[var(--color-ground)]'
                    : 'border-[var(--color-rule-strong)] bg-[var(--color-ground)]',
                ].join(' ')}
              >
                <div>
                  <div className="t-label text-[var(--color-ink-faint)]">{plan.name}</div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="font-mono text-[34px] tabular text-[var(--color-ink)]">
                      {plan.price}
                    </span>
                    <span className="text-[13px] text-[var(--color-ink-muted)]">{plan.unit}</span>
                  </div>
                  <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                    {plan.line}
                  </p>
                </div>
                <ButtonLink
                  href={plan.href}
                  variant={plan.primary ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  {plan.cta}
                </ButtonLink>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-[var(--color-rule)]">
        <Container width="wide" className="flex flex-col items-center py-24 text-center md:py-32">
          <Reveal>
            <h2 className="t-head max-w-[18ch]">Start with the next receipt in your pocket.</h2>
          </Reveal>
          <Reveal>
            <p className="t-lede mt-6 max-w-[46ch] text-[var(--color-ink-muted)]">
              Twenty receipts a month, free, no card. You will know by the third one whether it
              reads your dockets properly.
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
