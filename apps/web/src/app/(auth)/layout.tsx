import type { ReactNode } from 'react';
import Link from 'next/link';

import { Container } from '@/design/primitives';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-ground)]">
      <header className="border-b border-[var(--color-rule)] py-5">
        <Container width="prose">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">
            Snap Apps
          </Link>
        </Container>
      </header>
      <main className="flex flex-1 items-center justify-center py-12">
        <Container width="prose">
          <div className="mx-auto w-full max-w-[420px]">{children}</div>
        </Container>
      </main>
    </div>
  );
}
