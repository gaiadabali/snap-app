import Link from 'next/link';

import { Assurances, Phone, Reveal, StoreButtons } from '@/design/site';
import { HomeScreen } from '@/design/site/app-ui';
import { Icon } from '@/design/site/icons';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

import './cta-styles.css';

/**
 * The close. One large panel in the app's own hero-card blue, so the page
 * ends on the colour the phone's first screen opens on. The copy sits on the
 * left; the home screen rises out of the panel's bottom edge on the right,
 * tilted a little toward it and cropped by the panel, the way you hold a
 * phone up to show someone.
 *
 * The phone is a picture (aria-hidden); everything it shows is stated in the
 * page. The panel carries no new claims: the free allowance is the shared
 * constant and the stores are the kit's own pair, iPhone included as
 * "in development".
 */
export function HomeCta() {
  return (
    <section className="section-tight" aria-labelledby="home-cta-title">
      <div className="shell">
        <div className="cta-panel grid lg:grid-cols-[1.1fr_0.9fr]">
          <div className="cta-sheen" aria-hidden />
          <div className="cta-dots" aria-hidden />

          <Reveal stagger className="cta-copy relative z-[2] px-7 pb-2 pt-12 sm:px-12 sm:pt-14 lg:py-20 lg:pl-16 lg:pr-4">
            <h2 id="home-cta-title" className="hd-1 max-w-[14ch] text-[var(--s-ink)]">
              Start with the receipt in your pocket.
            </h2>
            <p className="lede mt-6 max-w-[34ch]">
              Photograph the next docket you are handed. The first {FREE_SCANS_AT_SIGNUP} scans are on
              us, and there is no card to enter.
            </p>
            <div className="mt-9">
              <StoreButtons />
              <div className="mt-5">
                <Link href="/register" className="cta-link">
                  Start free on the web
                  <Icon name="arrow-right" size={16} />
                </Link>
              </div>
            </div>
            <Assurances
              className="mt-8"
              items={[`${FREE_SCANS_AT_SIGNUP} free scans`, 'No card', 'No subscription']}
            />
          </Reveal>

          <Reveal
            variant="fade"
            className="relative h-[300px] sm:h-[380px] lg:h-auto lg:min-h-[540px]"
          >
            <div className="absolute inset-x-0 top-8 flex justify-center lg:top-16">
              <div className="cta-rise">
                <div className="cta-tilt">
                  <Phone className="[--pw:250] sm:[--pw:290] lg:[--pw:324]">
                    <HomeScreen />
                  </Phone>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
