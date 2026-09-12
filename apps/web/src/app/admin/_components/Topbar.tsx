import { Badge } from '@/design/primitives';

import { CommandPalette, type PaletteHit } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';

export function Topbar({ staffName, index }: { staffName: string; index: PaletteHit[] }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-[var(--color-rule)] bg-[var(--color-surface)] px-4">
      <CommandPalette index={index} />
      <div className="ml-auto flex items-center gap-3">
        <Badge tone="accent">Platform staff</Badge>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{staffName}</span>
        <ThemeToggle />
      </div>
    </header>
  );
}
