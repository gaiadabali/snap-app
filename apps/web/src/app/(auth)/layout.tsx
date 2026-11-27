import type { ReactNode } from 'react';
import Link from 'next/link';

import { FREE_SCANS_AT_SIGNUP } from '@/app/(marketing)/pricing/credit-packs';
import { Phone } from '@/design/site';
import { HomeScreen } from '@/design/site/app-ui';
import { SnapLockup } from '@/design/site/icons';
import '@/design/site/site.css';

import './auth.css';

/**
 * Split screen: the form on the left, the app on the right. Under `lg` the
 * brand panel drops to a slim strip above the form and the phone is not drawn.
 * The phone is a picture (`aria-hidden`); the one claim beside it is text.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site auth-split">
      <div className="auth-form-col">
        <header className="auth-top">
          <Link href="/" aria-label="SnapApps, home" className="auth-logo">
            <SnapLockup height={41} />
          </Link>
        </header>
        <main className="auth-main">
          <div className="auth-main-inner">{children}</div>
        </main>
      </div>

      <aside className="auth-brand" aria-label="About SnapApps">
        <div className="auth-brand-glow" aria-hidden />
        <div className="auth-brand-phone">
          <Phone className="[--pw:290] xl:[--pw:320]">
            <HomeScreen />
          </Phone>
        </div>
        <p className="auth-brand-line">
          Photograph a docket. SnapApps reads every line. {FREE_SCANS_AT_SIGNUP} free scans to
          start, no card.
        </p>
      </aside>
    </div>
  );
}
