import type { ReactNode } from 'react';

import { Container } from '@/design/primitives';

import { Tabs } from './_components/Tabs';

/**
 * Shared shell for the three governance areas: AI, Operations, Settings.
 *
 * Deliberately has no `page.tsx` alongside it — this route group contributes
 * no route of its own at `/admin`. That page belongs to the people/tenants
 * surface (`src/app/admin/(people)/`), which this build does not touch. Each
 * area under here (`/admin/ai`, `/admin/operations`, `/admin/settings`) is a
 * real route with its own landing content.
 */
export default function GovernanceLayout({ children }: { children: ReactNode }) {
  return (
    <Container width="full" className="py-8">
      <Tabs
        items={[
          { href: '/admin/ai', label: 'AI' },
          { href: '/admin/operations', label: 'Operations' },
          { href: '/admin/settings', label: 'Settings' },
        ]}
      />
      <div className="pt-6">{children}</div>
    </Container>
  );
}
