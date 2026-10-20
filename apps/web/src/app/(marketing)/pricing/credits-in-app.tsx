import { IconTile, Phone, Reveal, ILLUSTRATIVE_NOTE, type IconName } from '@/design/site';
import { CreditsScreen } from '@/design/site/app-ui';

/**
 * The balance, where it lives. The phone is a picture (aria-hidden), so each
 * thing it shows is also written out beside it.
 */
const FACTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'wallet',
    title: 'One number: credits you own',
    body: 'It never resets and never expires. Scan, and it goes down by one.',
  },
  {
    icon: 'tag',
    title: 'The same packs as this page',
    body: 'The top-up screen lists these sizes at this rate. Buying is not open yet; the questions below say more.',
  },
  {
    icon: 'users',
    title: 'Shared by the household',
    body: 'Credits belong to the workspace, not to a person, so everyone in it draws from one balance.',
  },
];

export function CreditsInApp() {
  return (
    <section className="section band-mist overflow-hidden">
      <div className="shell">
        <div className="grid items-center gap-x-24 gap-y-16 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal variant="scale" className="relative mx-auto flex w-full justify-center">
            <div className="horizon" aria-hidden style={{ width: '120%', height: '70%', left: '-10%', top: '15%' }} />
            <Phone className="relative [--pw:280] sm:[--pw:320]">
              <CreditsScreen />
            </Phone>
          </Reveal>

          <div>
            <Reveal>
              <h2 className="hd-2">Your balance lives in the app.</h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[44ch]">
                There is no plan to be on, so there is nothing to manage. The app shows what you have left and counts
                it down as you scan.
              </p>
            </Reveal>

            <Reveal as="ul" stagger className="mt-10 grid gap-3">
              {FACTS.map((f) => (
                <li key={f.title} className="card flex items-start gap-4 p-5">
                  <IconTile name={f.icon} tone="blue" size={44} />
                  <div>
                    <h3 className="hd-4">{f.title}</h3>
                    <p className="body mt-1">{f.body}</p>
                  </div>
                </li>
              ))}
            </Reveal>

            <p className="small mt-6">{ILLUSTRATIVE_NOTE}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
