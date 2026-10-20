import type { ReactNode } from 'react';

/**
 * The top of a docs article: a small label, the title, nothing else.
 * Replaces the ledger-era `ArticleHero`. The lede paragraph that follows is
 * written in each page as `<p className="docs-lead">`.
 */
export function DocHeader({ title, kicker = 'Documentation' }: { title: ReactNode; kicker?: string }) {
  return (
    <header className="docs-header">
      <div className="kicker">{kicker}</div>
      <h1 className="docs-title">{title}</h1>
    </header>
  );
}
