import { Phone, Reveal, SectionHead, aud } from '@/design/site';
import {
  AppBody,
  AppScreen,
  AppSectionTitle,
  AppTitleBar,
  CatIcon,
  FindingScreen,
} from '@/design/site/app-ui';
import { CHECKS, DOCKET, FINDINGS } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

/**
 * "What you see when it is not sure."
 *
 * Two phones, the app being honest in two different ways: a reading that
 * leaves one price blank rather than guess it, and a finding that a docket is
 * not a valid tax invoice, with a fix.
 *
 * Drawn to what the app really does. When the reader is not confident about a
 * field it leaves it EMPTY and flags it for review (support: "leave a field
 * blank rather than guess … fill it in on the review screen"). An earlier
 * draft showed a quoted "I could not read this" with a "Provisional" pill;
 * in the app "Provisional" means the on-device preview awaiting the server's
 * read, which is a different thing. The words in the phones are repeated as text beside
 * them, because a phone is a picture.
 */

const RULES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'eye',
    title: 'It leaves a blank rather than guess.',
    body: 'A figure it is not confident about is left empty and flagged for you to fill in, instead of a plausible number. A wrong figure is worse than a missing one.',
  },
  {
    icon: 'alert',
    title: 'It tells you what is wrong, and why.',
    body: 'A missing ABN, an ABN that fails its checksum, no GST breakdown. Each finding names the rule it broke and what that costs you.',
  },
  {
    icon: 'check-circle',
    title: 'It puts the fix on the same screen.',
    body: 'Add the ABN, retake the photo, or ask the supplier for a proper tax invoice. A human decides. The app does not fill the gap for you.',
  },
];

export function Unsure() {
  const finding = FINDINGS[2];
  return (
    <section className="section band-mist">
      <div className="shell">
        <div className="grid items-center gap-x-16 gap-y-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <SectionHead
              align="left"
              title="What you see when it is not sure."
              lede="A confident wrong number is worse than a blank one. So when the app is not sure, it stops and asks."
            />

            <Reveal stagger as="ul" className="mt-10 flex flex-col gap-3">
              {RULES.map((r) => (
                <li key={r.title} className="card flex gap-4 p-5">
                  <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]">
                    <Icon name={r.icon} size={20} />
                  </span>
                  <div>
                    <h3 className="hd-4">{r.title}</h3>
                    <p className="small mt-1">{r.body}</p>
                  </div>
                </li>
              ))}
            </Reveal>
          </div>

          <div className="relative">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '90%', height: '70%', left: '5%', top: '15%' }}
            />
            <Reveal variant="scale" className="relative flex items-start justify-center gap-3 sm:gap-6">
              <figure className="m-0 flex flex-col items-center sm:mt-14">
                <Phone className="[--pw:158] sm:[--pw:232] lg:[--pw:244]">
                  <UnsureScreen />
                </Phone>
                <figcaption className="small mt-4 max-w-[26ch] text-center">
                  A price it was not sure of, left blank for you to fill in.
                </figcaption>
              </figure>
              <figure className="m-0 flex flex-col items-center">
                <Phone className="[--pw:158] sm:[--pw:232] lg:[--pw:244]">
                  <FindingScreen />
                </Phone>
                <figcaption className="small mt-4 max-w-[26ch] text-center">
                  {finding.title} on a {aud(finding.amount)} tax invoice, with a fix.
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A reading that abstains. It is the same docket as everywhere else on the
 * site, with the last line's price left blank: the other lines are shown, the
 * total check is waiting, and the app asks rather than filling the gap.
 */
function UnsureScreen() {
  const lines = DOCKET.lines;
  const lastIndex = lines.length - 1;
  return (
    <AppScreen tab={false}>
      <AppBody>
        <AppTitleBar title="Receipt" />

        <div className="app-card px-[18px] pt-[16px] pb-[18px]">
          <div className="flex items-center gap-[12px]">
            <CatIcon category="Groceries" hue="#3BA55C" size={46} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-bold tracking-[-0.3px]">{DOCKET.merchant}</div>
              <div className="text-[13px] text-[var(--a-ink-3)]">
                {DOCKET.place} · {DOCKET.date.replace(' 2026', '')}
              </div>
            </div>
          </div>
          <div className="mt-[14px] flex items-end justify-between">
            <div>
              <div className="text-[13px] text-[var(--a-ink-3)]">Total</div>
              <div className="text-[38px] leading-[42px] font-bold tracking-[-1.2px]">{aud(DOCKET.total)}</div>
            </div>
            <span className="mb-[4px] inline-flex items-center gap-[6px] rounded-full bg-[var(--a-warn-soft)] px-[10px] py-[5px] text-[12.5px] font-semibold text-[var(--a-warn)]">
              <Icon name="alert" size={13} strokeWidth={2.4} /> Needs a look
            </span>
          </div>
        </div>

        <div className="mt-[12px] rounded-[20px] border border-[color-mix(in_srgb,var(--a-warn)_32%,transparent)] bg-[var(--a-warn-soft)] px-[18px] py-[15px]">
          <div className="flex items-center gap-[10px] text-[var(--a-warn)]">
            <Icon name="eye" size={20} strokeWidth={2} />
            <span className="text-[16px] font-bold">One price left blank</span>
          </div>
          <p className="mt-[6px] text-[14px] leading-[20px] text-[var(--a-ink-2)]">
            It was not confident about the last price, so it left it empty rather than guess. Check the paper and fill it in.
          </p>
          <div className="mt-[12px] flex gap-[8px]">
            <span className="flex-1 rounded-[14px] bg-[var(--a-accent)] py-[11px] text-center text-[14.5px] font-semibold text-white">
              Fill it in
            </span>
          </div>
        </div>

        <AppSectionTitle title={`${lines.length} lines, 1 left blank`} />
        <div className="app-card px-[16px] py-[6px]">
          {lines.map((l, i) => (
            <div
              key={l.label}
              className={`flex items-center gap-[10px] py-[9px] ${i > 0 ? 'border-t border-[var(--a-rule)]' : ''}`}
            >
              <span className="flex-1 truncate text-[14.5px]">{l.label}</span>
              {i === lastIndex ? (
                <span className="rounded-full border border-dashed border-[var(--a-warn)] px-[10px] py-[2px] text-[12px] font-semibold text-[var(--a-warn)]">
                  Blank
                </span>
              ) : (
                <>
                  <span
                    className={`rounded-full px-[8px] py-[2px] text-[11px] font-semibold ${
                      l.taxable
                        ? 'bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]'
                        : 'bg-[var(--a-good-soft)] text-[var(--a-good)]'
                    }`}
                  >
                    {l.taxable ? 'Taxable' : 'GST-free'}
                  </span>
                  <span className="w-[52px] text-right text-[14.5px] font-semibold">{l.amount}</span>
                </>
              )}
            </div>
          ))}
        </div>

        <AppSectionTitle title="Checks" />
        <div className="app-card flex items-center gap-[10px] px-[16px] py-[14px] text-[14px]">
          <span className="grid size-[22px] place-items-center rounded-full bg-[var(--a-warn-soft)] text-[var(--a-warn)]">
            <Icon name="alert" size={12} strokeWidth={2.6} />
          </span>
          <span className="flex-1">{CHECKS[3].label}</span>
          <span className="text-[12.5px] font-semibold text-[var(--a-warn)]">Waiting</span>
        </div>
      </AppBody>
    </AppScreen>
  );
}
