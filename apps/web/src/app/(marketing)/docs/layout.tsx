import type { Metadata } from 'next';

import { DocPager } from './_components/DocPager';
import { DocsNav } from './_components/DocsNav';
import './docs.css';

export const metadata: Metadata = {
  title: { default: 'Docs', template: '%s · Docs · Snap Apps' },
  description: 'User guides for Snap Apps: capture, review, the ledger, BAS, the tax pack, and Xero.',
};

/**
 * The docs shell: a sticky grouped sidebar plus whatever the page renders.
 *
 * A reading surface, so the type is the design: a ~68ch measure, a clear h2
 * rhythm, no decoration that carries no information. Each article page lays
 * out its own "On this page" column beside the text (see `.docs-page`).
 * Styles live in `./docs.css`, prefixed `docs-`.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell docs-shell">
      <div className="docs-grid">
        <DocsNav />
        <div className="docs-main">
          {children}
          <DocPager />
        </div>
      </div>
    </div>
  );
}
