import { cx } from '@/design/primitives';

import type { ChatMessage } from './types';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming' || message.status === 'pending';

  return (
    <div className={cx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[85%] rounded-[var(--radius-lg)] px-3.5 py-2.5 text-[14px] leading-relaxed',
          isUser
            ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
            : 'bg-[var(--color-surface)] text-[var(--color-ink)]',
        )}
      >
        {message.content.length > 0 ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.status === 'pending' ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-ink-faint)]" aria-label="Thinking">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
          </span>
        ) : null}
        {isStreaming && message.content.length > 0 ? (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-current align-text-bottom" />
        ) : null}

        {message.status === 'error' ? (
          <p className="mt-1 text-[12px] text-[var(--color-risk)]">Something went wrong.</p>
        ) : null}

        {message.citations && message.citations.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-0.5 border-t border-[var(--color-rule)] pt-2">
            {message.citations.map((c, i) => (
              <li key={i} className="text-[11px] text-[var(--color-ink-faint)]">
                {c.label} — <span className="italic">{c.source}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
