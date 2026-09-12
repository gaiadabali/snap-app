import type { ReactNode } from 'react';

import { SectionTitle } from '@/design/primitives';

import { Tabs } from '../_components/Tabs';

export default function AiLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <SectionTitle
        eyebrow="Governance · AI"
        title="Model configuration and spend"
        lede="Which model serves which capability, the escalation ladder, key management, and where the inference budget is going."
      />
      <div className="mt-6">
        <Tabs
          items={[
            { href: '/admin/ai/models', label: 'Models & routing' },
            { href: '/admin/ai/keys', label: 'API keys' },
            { href: '/admin/ai/usage', label: 'Usage & spend' },
          ]}
        />
      </div>
      <div className="pt-6">{children}</div>
    </div>
  );
}
