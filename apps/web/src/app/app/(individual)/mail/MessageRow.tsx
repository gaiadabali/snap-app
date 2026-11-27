'use client';

import Link from 'next/link';
import type { FolderKey, MessageSummary } from '@snap/mail-engine';

import { cx } from '@/design/primitives';
import { FOLDER_LABEL, listDate, recipientsLabel, senderLabel } from '@/lib/panels/mail-format';
import { MailIcon } from './MailIcon';

/**
 * One line of a message list. The checkbox and the star are real buttons beside the
 * link, never inside it, so a click on either never opens the message.
 *
 * In Sent and Drafts the "who" is the recipients, not the sender (who is always you).
 */
export function MessageRow({
  message,
  href,
  selected,
  onSelect,
  onFlag,
  showFolder = false,
  now,
}: {
  message: MessageSummary;
  href: string;
  selected: boolean;
  onSelect: (next: boolean) => void;
  onFlag: (next: boolean) => void;
  /** Search results span folders, so they say which one each hit is in. */
  showFolder?: boolean;
  now?: Date;
}) {
  const outgoing = message.folder === 'sent' || message.folder === 'drafts';
  const who = outgoing ? `To: ${recipientsLabel(message.to)}` : senderLabel(message.from);
  const subject = message.subject.trim() || '(no subject)';
  return (
    <li
      data-testid="mail-row"
      data-unread={message.unread ? 'true' : 'false'}
      className={cx(
        'group relative flex items-stretch transition-colors',
        selected ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]',
      )}
    >
      <div className="flex items-center gap-0.5 pl-1.5 sm:pl-3">
        <label className="grid size-9 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`Select message from ${who}: ${subject}`}
            className="size-4 accent-[var(--color-accent-strong)]"
          />
        </label>
        <button
          type="button"
          onClick={() => onFlag(!message.flagged)}
          aria-pressed={message.flagged}
          aria-label={message.flagged ? 'Remove star' : 'Star this message'}
          className={cx(
            'grid size-9 place-items-center rounded-[var(--radius-sm)]',
            message.flagged ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
          )}
        >
          <MailIcon name="star" size={17} fill={message.flagged ? 'currentColor' : 'none'} />
        </button>
      </div>
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-3 sm:pr-4">
        <span
          aria-hidden
          className={cx('size-2 shrink-0 rounded-full', message.unread ? 'bg-[var(--color-accent)]' : 'bg-transparent')}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
          <span
            className={cx(
              'truncate text-[14px] sm:w-48 sm:shrink-0',
              message.unread ? 'font-semibold text-[var(--color-ink)]' : 'font-medium text-[var(--color-ink-muted)]',
            )}
          >
            {who}
            {message.unread ? <span className="sr-only"> (unread)</span> : null}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[14px]">
            <span className={cx('min-w-0 truncate sm:max-w-[60%] sm:shrink-0', message.unread ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink)]')}>
              {subject}
            </span>
            {message.preview ? (
              <span className="hidden truncate text-[var(--color-ink-muted)] sm:inline">
                <span aria-hidden>{'– '}</span>
                {message.preview}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 self-start pt-0.5 text-[12px] text-[var(--color-ink-muted)] sm:self-center sm:pt-0">
          {showFolder && message.folder ? (
            <span className="t-label hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 sm:inline">
              {FOLDER_LABEL[message.folder as FolderKey]}
            </span>
          ) : null}
          {message.hasAttachment ? (
            <span className="text-[var(--color-ink-muted)]">
              <MailIcon name="paperclip" size={14} />
              <span className="sr-only">Has attachments</span>
            </span>
          ) : null}
          <time dateTime={message.receivedAt} className="tabular whitespace-nowrap">
            {listDate(message.receivedAt, now)}
          </time>
        </span>
      </Link>
    </li>
  );
}
