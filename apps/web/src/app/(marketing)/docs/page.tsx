import Link from 'next/link';
import type { Metadata } from 'next';

import { Icon } from '@/design/site/icons';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import { DOCS_GROUPS, docsInGroup } from './_components/nav';

export const metadata: Metadata = { title: 'Docs' };

export default function DocsIndexPage() {
  return (
    <div className="docs-hub">
      <header className="docs-hero">
        <div className="kicker">Documentation</div>
        <h1 className="docs-title docs-title-hub">How Snap Apps works</h1>
        <p className="lede">
          Guides for using the product day to day — capturing receipts, correcting what the model
          got wrong,{BUSINESS_SURFACES_ENABLED ? ' understanding your BAS position,' : ''} and getting
          your data out. Not an API reference.
        </p>
        <Link href="/support" className="docs-search">
          <Icon name="search" size={20} />
          <span>Can&apos;t find it? Search the help centre</span>
          <Icon name="arrow-right" size={18} className="docs-search-go" />
        </Link>
      </header>

      {DOCS_GROUPS.map((group) => {
        const id = `topic-${group.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <section key={group} className="docs-topic" aria-labelledby={id}>
            <h2 id={id} className="docs-topic-title">
              {group}
            </h2>
            <ul className="docs-cards">
              {docsInGroup(group).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="card card-hover docs-card">
                    <span className="docs-card-title">{item.title}</span>
                    <span className="docs-card-summary">{item.summary}</span>
                    <Icon name="arrow-right" size={18} className="docs-card-go" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
