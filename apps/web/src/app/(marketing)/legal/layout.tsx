import type { Metadata } from 'next';

import { LegalNav } from './_components/LegalNav';
import './legal.css';

export const metadata: Metadata = {
  title: { default: 'Legal', template: '%s · Snap Apps' },
};

/**
 * Shell for every legal page.
 *
 * The draft banner is not decoration — docs/PLAN.md §7 is the source material
 * for these pages, but nothing here has been through a qualified Australian
 * legal practitioner, and it must not be mistaken for final text. It stays
 * until that review happens; removing it is a legal sign-off decision, not an
 * engineering one.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell-narrow legal-shell">
      <LegalNav />

      <div role="note" className="legal-draft">
        <strong>Draft — not yet reviewed.</strong> This page is drafted from Snap Apps&apos; own
        internal engineering and product records. It has not been reviewed or approved by a
        qualified Australian legal practitioner and must not be relied on, published, or presented
        to a customer as final until that review is complete.
      </div>

      <div className="legal-body">{children}</div>
    </div>
  );
}
