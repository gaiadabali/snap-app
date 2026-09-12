'use client';

import { cx } from '@/design/primitives';

import { Composer } from './Composer';
import { MessageList } from './MessageList';
import type { ChatMessage } from './types';

export function ChatPanel({
  open,
  onClose,
  messages,
  onSend,
  onCancel,
  sending,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onCancel: () => void;
  sending: boolean;
}) {
  return (
    <>
      {/* Backdrop — click to dismiss, present only so the panel reads as modal on
          small screens. Never intercepts a click when the panel is closed. */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={cx(
          'fixed inset-0 z-40 bg-black/20 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Snap Apps assistant"
        aria-hidden={!open}
        className={cx(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col',
          'border-l border-[var(--color-rule)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)]',
          'transition-transform duration-250 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-rule)] px-4 py-3.5">
          <div>
            <div className="text-[14px] font-semibold text-[var(--color-ink)]">Snap Apps assistant</div>
            <div className="text-[12px] text-[var(--color-ink-muted)]">
              Not connected yet — every reply here is a stub.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <MessageList messages={messages} />
        <Composer onSend={onSend} onCancel={onCancel} sending={sending} />
      </section>
    </>
  );
}
