'use client';

import { cx } from '@/design/primitives';

export function ChatLauncher({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? 'Close assistant' : 'Open assistant'}
      className={cx(
        'fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full',
        'bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-lift)]',
        'transition-transform duration-150 hover:scale-105',
      )}
    >
      {open ? (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
