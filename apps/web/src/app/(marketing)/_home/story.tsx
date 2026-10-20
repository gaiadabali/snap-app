import { Chip, Phone, Reveal, SectionHead, Shell, aud } from '@/design/site';
import { CaptureScreen, HomeScreen, ReceiptScreen } from '@/design/site/app-ui';
import { BUDGET, DOCKET } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

import { StoryStage } from './story-stage';
import './story.css';

/**
 * "Snap. Read. Sorted." — how it works, in three moves.
 *
 * lg and up: a phone is pinned on the left while three tall step panels scroll
 * past on the right. The step under the centre line decides which of three
 * stacked screens the phone shows (see story-stage.tsx and story.css). The
 * server render is step 1 with all the copy visible.
 *
 * Below lg nothing is pinned: each step shows its own phone, cropped at the
 * hip so three of them do not make a very long page, above its copy.
 *
 * The phones are pictures (`aria-hidden`). Every figure they show that matters
 * is also in the copy or the chips, as text.
 */

const STEPS = [
  {
    n: 1,
    title: 'Snap it',
    body: 'Point the camera at the docket. Snap Apps frames the paper and takes the shot, and the photo is kept exactly as taken: it is your true copy for five years. No signal at the servo? The scan waits and uploads when you are back online.',
    chips: [
      { icon: 'camera', label: 'Auto-capture' },
      { icon: 'lock', label: 'Original kept as taken' },
      { icon: 'cloud-off', label: 'Works offline' },
    ],
  },
  {
    n: 2,
    title: 'It reads every line',
    body: `Each item and its price comes off the docket, along with which lines carry GST. GST-free and taxable come apart to the cent: ${aud(DOCKET.gstFree)} and ${aud(DOCKET.taxable)} here, with ${aud(DOCKET.gst)} of GST. Then the docket is checked as a tax invoice, and the supplier’s ABN against the ATO checksum.`,
    chips: [
      { icon: 'layers', label: `${DOCKET.lines.length} lines read` },
      { icon: 'check-circle', label: 'Tax invoice check' },
      { icon: 'shield', label: 'ABN checksum' },
    ],
  },
  {
    n: 3,
    title: 'It’s sorted',
    body: 'The docket is filed under a category and counted against your budget, so what is left to spend is always current. Search by merchant, category or amount. When your accountant asks, export everything as CSV.',
    chips: [
      { icon: 'tag', label: 'Filed under Groceries' },
      { icon: 'wallet', label: `${aud(BUDGET.left)} left to spend` },
      { icon: 'download', label: 'CSV export' },
    ],
  },
] as const satisfies readonly {
  n: 1 | 2 | 3;
  title: string;
  body: string;
  chips: readonly { icon: IconName; label: string }[];
}[];

function StepScreen({ n }: { n: 1 | 2 | 3 }) {
  if (n === 1) return <CaptureScreen />;
  if (n === 2) return <ReceiptScreen />;
  return <HomeScreen />;
}

export function HomeStory() {
  return (
    <section className="section relative">
      <Shell>
        <SectionHead
          align="split"
          title="Snap. Read. Sorted."
          lede="Three steps from a crumpled docket to a record you can search, budget against and export."
        />

        <StoryStage className="story-stage mt-14 lg:mt-24">
          <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-x-10 xl:gap-x-16">
            {/* ── The pinned phone (lg and up) ───────────────────────── */}
            <div
              className="relative hidden overflow-hidden rounded-[32px] bg-[var(--s-mist)] pb-8 lg:sticky lg:top-[5.5rem] lg:grid lg:h-[min(48rem,calc(100svh-7rem))] lg:self-start lg:place-items-center"
              aria-hidden
            >
              <div
                className="horizon"
                style={{ width: '80%', height: '55%', left: '10%', top: '22%', opacity: 0.8 }}
              />
              <Reveal variant="scale" className="relative">
                <Phone className="story-phone">
                  <div className="story-screens">
                    {STEPS.map((s) => (
                      <div key={s.n} className="story-screen" style={{ ['--n' as string]: s.n }}>
                        <StepScreen n={s.n} />
                      </div>
                    ))}
                  </div>
                </Phone>
              </Reveal>
              <div className="absolute inset-x-0 bottom-7 flex items-center justify-center gap-2">
                {STEPS.map((s) => (
                  <span key={s.n} className="story-dot" style={{ ['--n' as string]: s.n }} />
                ))}
              </div>
            </div>

            {/* ── The steps ──────────────────────────────────────────── */}
            <ol className="relative lg:pl-[88px]">
              {STEPS.map((s, i) => (
                <li
                  key={s.n}
                  data-story-panel=""
                  data-n={s.n}
                  className="story-panel relative flex flex-col gap-8 py-8 lg:min-h-[75vh] lg:justify-center lg:gap-0 lg:py-0"
                  style={{ ['--n' as string]: s.n }}
                >
                  <span className="story-node" aria-hidden />
                  {i < STEPS.length - 1 ? <span className="story-seg" aria-hidden /> : null}

                  {/* Below lg: this step's own phone, cropped. */}
                  <Reveal
                    variant="scale"
                    className="relative mx-auto flex h-[24rem] w-full max-w-[34rem] justify-center overflow-hidden rounded-[28px] bg-[var(--s-mist)] pt-8 lg:hidden"
                  >
                    <Phone className="[--pw:236]">
                      <StepScreen n={s.n} />
                    </Phone>
                  </Reveal>

                  <Reveal className="max-w-[30rem]">
                    <div className="story-num" aria-hidden>
                      {String(s.n).padStart(2, '0')}
                    </div>
                    <h3 className="hd-3 mt-5">
                      <span className="sr-only">Step {s.n}: </span>
                      {s.title}
                    </h3>
                    <p className="body mt-4">{s.body}</p>
                    <div className="story-chips mt-6">
                      {s.chips.map((c) => (
                        <Chip key={c.label}>
                          <Icon name={c.icon} size={15} className="text-[var(--s-blue-text)]" />
                          {c.label}
                        </Chip>
                      ))}
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </StoryStage>
      </Shell>
    </section>
  );
}
