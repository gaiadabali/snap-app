import { IconTile, Phone, Reveal, SectionHead, aud } from '@/design/site';
import { CaptureScreen, DocketPaper, FindingScreen, ReceiptScreen } from '@/design/site/app-ui';
import { CHECKS, DOCKET, FINDINGS } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

import { ReadingToggle } from './_reading';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — Capture. A night panel with the camera at its centre and the four
 * things worth knowing about it on the right, tied to the phone by leaders.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CAPTURE_SPECS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'scan',
    title: 'It frames itself',
    body: 'Auto-capture finds the edges of the docket and takes the shot when you hold steady.',
  },
  {
    icon: 'lock',
    title: 'The original stays untouched',
    body: 'The photo you took is kept exactly as taken. Reading it never edits it.',
  },
  {
    icon: 'cloud-off',
    title: 'It works with no signal',
    body: 'Snap at the truck stop. Scans queue on the phone and upload when you are back in range.',
  },
  {
    icon: 'file',
    title: 'Photos and PDFs',
    body: 'Already have it as a photo, or as a PDF in your email? Add it the same way.',
  },
];

export function CaptureChapter() {
  return (
    <section id="capture" aria-labelledby="capture-h" className="section-tight scroll-mt-[120px]">
      <div className="shell">
        <div className="night grain overflow-hidden rounded-[36px] px-6 py-14 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
          <div className="grid items-center gap-14 lg:grid-cols-[1fr_auto_1fr] lg:gap-[88px]">
            <div className="max-w-[30rem]">
              <Reveal>
                <h2 id="capture-h" className="hd-2 text-[clamp(1.9rem,2.9vw,2.6rem)]">
                  Snap it now. It uploads when you have signal.
                </h2>
              </Reveal>
              <Reveal delay={1}>
                <p className="lede mt-6">
                  Point the camera at a docket and the app does the rest. A long drive between towers does not
                  stop you; the photo waits on your phone until it can go.
                </p>
              </Reveal>
            </div>

            <Reveal variant="fade" className="feat-cap relative mx-auto">
              <div
                className="horizon"
                aria-hidden
                style={{ width: '140%', height: '60%', left: '-20%', top: '20%', opacity: 0.8 }}
              />
              <Phone className="relative [--pw:264] sm:[--pw:300]">
                <CaptureScreen animated />
              </Phone>
            </Reveal>

            <Reveal as="ul" stagger className="flex flex-col gap-7">
              {CAPTURE_SPECS.map((s) => (
                <li key={s.title} className="feat-spec flex items-start gap-4">
                  <IconTile name={s.icon} tone="blue" size={44} />
                  <div>
                    <h3 className="hd-4">{s.title}</h3>
                    <p className="small mt-1.5 max-w-[34ch]">{s.body}</p>
                  </div>
                </li>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — Reading. The docket, a switch between "total only" and "every line", and
 * the read receipt. The brackets on the docket and the cards in the panel use
 * the same two colours, so the eye joins them without a diagram.
 * ═══════════════════════════════════════════════════════════════════════════ */

function Row({
  tone,
  label,
  sub,
  value,
  strong = false,
}: {
  tone: 'green' | 'blue' | 'red' | 'ink';
  label: string;
  sub?: string;
  value: string;
  strong?: boolean;
}) {
  const bar =
    tone === 'green'
      ? 'bg-[var(--s-green-2)]'
      : tone === 'blue'
        ? 'bg-[var(--s-blue)]'
        : tone === 'red'
          ? 'bg-[var(--s-red)]'
          : 'bg-[var(--s-ink-4)]';
  const text =
    tone === 'green' ? 'text-[var(--s-green)]' : tone === 'blue' ? 'text-[var(--s-blue-text)]' : tone === 'red' ? 'text-[var(--s-red)]' : '';
  return (
    <div className="flex items-stretch gap-4 rounded-[18px] bg-[var(--s-card)] p-4 shadow-[var(--s-shadow-1)] ring-1 ring-[var(--s-edge)]">
      <span className={`w-1 shrink-0 rounded-full ${bar}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={`text-[0.8125rem] font-[620] ${text}`}>{label}</div>
        {sub ? <div className="small mt-0.5">{sub}</div> : null}
      </div>
      <div className={`figure self-center ${strong ? 'text-[1.75rem] font-[680]' : 'text-[1.25rem] font-[650]'}`}>{value}</div>
    </div>
  );
}

const LINES_PANEL = (
  <div className="flex flex-col gap-3">
    <Row tone="green" label="GST-free" sub="Milk, bread, eggs" value={aud(DOCKET.gstFree)} />
    <Row tone="blue" label="Taxable" sub="Hot pie, soft drink, flat white" value={aud(DOCKET.taxable)} />
    <Row
      tone="ink"
      label="GST on the docket"
      sub={`${aud(DOCKET.taxable)} ÷ 11, taxable lines only`}
      value={aud(DOCKET.gst)}
      strong
    />
  </div>
);

const TOTAL_PANEL = (
  <div className="flex flex-col gap-3">
    <Row tone="ink" label="Total on the docket" sub="One number, no lines" value={aud(DOCKET.total)} />
    <Row
      tone="red"
      label="GST if all of it were taxable"
      sub={`${aud(DOCKET.total)} ÷ 11`}
      value={aud(DOCKET.totalOnlyGst)}
      strong
    />
    <p className="small px-1">
      That is {aud(DOCKET.overClaim)} more GST than the docket supports. Over a year of servo stops it adds up
      to a problem.
    </p>
  </div>
);

export function ReadingChapter() {
  return (
    <section id="reading" aria-labelledby="reading-h" className="section band-mist scroll-mt-[120px]">
      <div className="shell">
        <SectionHead
          align="split"
          title={<span id="reading-h">Milk and a flat white are not taxed the same.</span>}
          lede="Plain food is GST-free. Hot food and soft drink are not. One docket can carry both, so Snap Apps reads each line's price, quantity and tax treatment instead of guessing from the total."
        />

        <div className="mt-16 grid items-center gap-12 lg:mt-20 lg:grid-cols-[290px_minmax(0,1fr)_260px] lg:gap-[60px] xl:grid-cols-[310px_minmax(0,1fr)_300px]">
          <Reveal variant="left" className="feat-cap mx-auto w-full max-w-[310px]">
            <DocketPaper locks className="w-full -rotate-2 lg:-rotate-3" />
          </Reveal>

          <Reveal delay={1} className="relative">
            <span className="feat-link feat-link-l" aria-hidden />
            <span className="feat-link feat-link-r" aria-hidden />
            <div className="card p-6 sm:p-8">
              <h3 className="hd-3 mb-1.5">Same docket, read two ways</h3>
              <p className="small mb-6 max-w-[42ch]">
                GST on a taxable line is one eleventh of its price. Flip the switch to see what a total-only
                reading does with the same {aud(DOCKET.total)}.
              </p>
              <ReadingToggle lines={LINES_PANEL} total={TOTAL_PANEL} />
            </div>
          </Reveal>

          <Reveal variant="right" delay={2} className="relative mx-auto">
            <Phone className="[--pw:260] xl:[--pw:290]">
              <ReceiptScreen />
            </Phone>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — Checks. A checklist down the left, the failing-receipt screen on the
 * right, and a row of real findings underneath.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CHECK_DETAIL = [
  'The words have to be on it. A plain till receipt is not one.',
  'Missing, or one digit out? The number is run through the ATO checksum on the spot.',
  'GST-free lines are left out, then the maths has to land on exactly one eleventh.',
  'Every line, added. If the docket disagrees with its own total, you hear about it.',
] as const;

export function ChecksChapter() {
  return (
    <section id="checks" aria-labelledby="checks-h" className="section scroll-mt-[120px]">
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          <div>
            <Reveal>
              <h2 id="checks-h" className="hd-2 max-w-[18ch]">
                A tax invoice is a checklist. The app runs it.
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[40ch]">
                A GST credit only holds if the invoice behind it follows the ATO&rsquo;s rules. Snap Apps checks
                each one the moment a docket is read.
              </p>
            </Reveal>

            <Reveal as="ol" stagger className="mt-10 divide-y divide-[var(--s-edge)] border-y border-[var(--s-edge)]">
              {CHECKS.map((c, i) => (
                <li key={c.label} className="flex items-start gap-4 py-5">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--s-green-soft)] text-[var(--s-green)]">
                    <Icon name="check" size={15} strokeWidth={2.6} />
                  </span>
                  <div>
                    <h3 className="hd-4">{c.label}</h3>
                    <p className="small mt-1 max-w-[52ch]">{CHECK_DETAIL[i]}</p>
                  </div>
                </li>
              ))}
              <li className="flex items-start gap-4 py-5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
                  <Icon name="user" size={15} strokeWidth={2.2} />
                </span>
                <div>
                  <h3 className="hd-4">The buyer is named on bigger invoices</h3>
                  <p className="small mt-1 max-w-[52ch]">
                    At $1,000 or more the invoice has to identify the buyer as well. The app looks for that too.
                  </p>
                </div>
              </li>
            </Reveal>
          </div>

          <Reveal variant="scale" className="relative mx-auto">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '120%', height: '70%', left: '-10%', top: '15%' }}
            />
            <div className="tilt-r relative">
              <Phone className="[--pw:280] sm:[--pw:316]">
                <FindingScreen />
              </Phone>
            </div>
          </Reveal>
        </div>

        {/* When one fails */}
        <div className="mt-20 lg:mt-28">
          <Reveal>
            <h3 className="hd-2 max-w-[24ch]">When one fails, you get a fix and not a red cross.</h3>
          </Reveal>
          <Reveal delay={1}>
            <p className="lede mt-5 max-w-[46ch]">
              Each flag says what is wrong with the docket and what to do about it, while the shop still
              remembers you.
            </p>
          </Reveal>
          <Reveal as="ul" stagger className="mt-10 grid gap-4 md:grid-cols-3">
            {FINDINGS.map((f, i) => (
              <li key={f.merchant} className="card flex flex-col p-6">
                <div className="flex items-center gap-3">
                  <IconTile name="alert" tone={i === 2 ? 'red' : 'amber'} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9375rem] font-[620] tracking-[-0.015em]">{f.merchant}</div>
                    <div className="small figure">{aud(f.amount)}</div>
                  </div>
                </div>
                <h4 className="hd-4 mt-5">{f.title}</h4>
                <p className="small mt-1.5">{f.body}</p>
              </li>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
