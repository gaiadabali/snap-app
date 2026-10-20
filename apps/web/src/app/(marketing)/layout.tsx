import type { ReactNode } from 'react';

import { ChatWidget } from '@/components/chat';
import '@/design/site/site.css';

import { SiteFooter } from './_components/site-footer';
import { SiteHeader } from './_components/site-header';

/**
 * Every marketing page sits under a floating header, so `main` clears it with
 * `pt-[84px]`. A page that wants its first section to run up behind the
 * header (the home hero) pulls itself back with `-mt-[84px]` and pads its own
 * top instead.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1 pt-[84px]">{children}</main>
      <SiteFooter />
      {/* Mounted once here rather than per-page: every route in this group
          nests inside this layout, so a second mount would render two widgets. */}
      <ChatWidget />
    </div>
  );
}
