import type { ReactNode } from 'react';

import { ChatWidget } from '@/components/chat';

import { SiteFooter } from './_components/site-footer';
import { SiteHeader } from './_components/site-header';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {/* Mounted once here rather than per-page: every route in this group
          nests inside this layout, so a second mount would render two widgets. */}
      <ChatWidget />
    </div>
  );
}
