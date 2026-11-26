'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Attachment, FolderKey, MessageDetail, UnsubscribeResult } from '@snap/mail-engine';
import { useMailClient, useMessage, useSandboxDocument } from '@snap/mail-engine/react';

import { Button, Select, buttonClasses, cx } from '@/design/primitives';
import {
  FOLDER_LABEL,
  fileSize,
  fullAddress,
  fullDate,
  initialsOf,
  mailErrorMessage,
  senderLabel,
} from '@/lib/panels/mail-format';
import { FOLDER_ORDER, composeHref, folderHref } from '@/lib/panels/mail-routes';
import { MailIcon } from './MailIcon';
import { useMailBase } from './MailRoot';
import { PlainBody, SandboxFrame } from './MessageBody';
import { ErrorBlock, ListSkeleton, Monogram, Notice, flashNotice, useIsDark, useNotice } from './MailUi';

type UnsubState =
  | { step: 'idle' }
  | { step: 'working' }
  | { step: 'done'; result: Extract<UnsubscribeResult, { status: 'done' }>; moved: boolean }
  | { step: 'link'; url: string }
  | { step: 'failed'; unavailable: boolean };

/** Only a plain https link is offered as a way out; the server has already vetted it. */
function httpsOnly(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function UnsubscribeBar({
  message,
  state,
  moveToJunk,
  onToggleMove,
  onUnsubscribe,
}: {
  message: MessageDetail;
  state: UnsubState;
  moveToJunk: boolean;
  onToggleMove: (next: boolean) => void;
  onUnsubscribe: () => void;
}) {
  const who = senderLabel(message.from);
  const canMove = message.folder !== 'junk' && message.folder !== 'spam';
  if (state.step === 'done') {
    return (
      <div role="status" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--color-good-soft)] px-3 py-2.5 text-[14px] text-[var(--color-good)]">
        <strong className="font-semibold">Unsubscribed.</strong> {who} has been told to stop. It can take a few days to take
        effect.{state.moved ? ' This message has been moved to Junk.' : ''}
      </div>
    );
  }
  if (state.step === 'link') {
    const href = httpsOnly(state.url);
    return (
      <div role="status" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2.5 text-[14px] text-[var(--color-ink)]">
        {who} needs you to finish unsubscribing on their website.{' '}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Open the unsubscribe page
          </a>
        ) : (
          'The link they gave us is not safe to open, so it has been left out.'
        )}
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-[14px]">
        <div className="text-[var(--color-ink)]">This looks like a mailing list. Stop mail from {who}.</div>
        {canMove ? (
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
            <input
              type="checkbox"
              checked={moveToJunk}
              onChange={(e) => onToggleMove(e.target.checked)}
              className="size-4 accent-[var(--color-accent-strong)]"
            />
            Also move this message to Junk
          </label>
        ) : null}
        {state.step === 'failed' ? (
          <div role="alert" className="mt-1 text-[13px] text-[var(--color-risk)]">
            {state.unavailable
              ? 'This sender does not offer a way to unsubscribe from here.'
              : 'That did not go through. Try again, or use the link in the message.'}
          </div>
        ) : null}
      </div>
      <Button variant="secondary" size="sm" onClick={onUnsubscribe} disabled={state.step === 'working'} className="shrink-0 self-start sm:self-center">
        {state.step === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
      </Button>
    </div>
  );
}

function AttachmentList({ items, onDownload, busy }: { items: Attachment[]; onDownload: (a: Attachment) => void; busy: string | null }) {
  const shown = items.filter((a) => !a.inline);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Attachments" className="mt-5 border-t border-[var(--color-rule)] pt-4">
      <h3 className="t-label mb-2 text-[var(--color-ink-muted)]">
        {shown.length} {shown.length === 1 ? 'attachment' : 'attachments'}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <li key={a.blobId}>
            <button
              type="button"
              onClick={() => onDownload(a)}
              disabled={busy === a.blobId}
              className="flex max-w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-3 py-2 text-left text-[13px] hover:border-[var(--color-ink)] disabled:opacity-60"
              aria-label={`Download ${a.name} (${fileSize(a.size)})`}
            >
              <MailIcon name="paperclip" size={15} />
              <span className="min-w-0 truncate font-medium text-[var(--color-ink)]">{a.name}</span>
              <span className="shrink-0 text-[var(--color-ink-muted)] tabular">{fileSize(a.size)}</span>
              <MailIcon name="download" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HeaderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-10 shrink-0 text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

/** Saves a downloaded part without ever letting the browser open it as a page. */
function saveBlob(blob: Blob, name: string): void {
  const safe = new Blob([blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(safe);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Reader({ id }: { id: string }) {
  const client = useMailClient();
  const base = useMailBase();
  const router = useRouter();
  const dark = useIsDark();
  const { message, loading, error } = useMessage(id);
  const html = useSandboxDocument(id, message?.hasHtml === true, { dark });
  const { notice, fail, clear } = useNotice();
  const [flagged, setFlagged] = useState<boolean | null>(null);
  const [plain, setPlain] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [unsub, setUnsub] = useState<UnsubState>({ step: 'idle' });
  const [moveToJunk, setMoveToJunk] = useState(true);

  // Opening a message reads it, once.
  const unread = message?.unread === true;
  useEffect(() => {
    if (unread) void client.setRead([id], true).catch(() => undefined);
  }, [client, id, unread]);

  if (error && !message) {
    const gone = error.code === 'rejected';
    return (
      <div>
        <BackLink href={folderHref(base, 'inbox')} label="Inbox" />
        <ErrorBlock message={gone ? 'That message is not here any more. It may have been deleted.' : mailErrorMessage(error)} />
      </div>
    );
  }
  if (loading || !message) {
    return (
      <div>
        <BackLink href={folderHref(base, 'inbox')} label="Inbox" />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  const folder: FolderKey = message.folder ?? 'inbox';
  const back = folderHref(base, folder);
  const isFlagged = flagged ?? message.flagged;
  const everyone = message.to.length + message.cc.length > 1;

  const leave = (text: string) => {
    flashNotice(text);
    router.push(back);
  };

  async function act(task: () => Promise<void>, done: string) {
    clear();
    try {
      await task();
      leave(done);
    } catch (e) {
      fail(mailErrorMessage(e));
    }
  }

  async function download(att: Attachment) {
    setDownloading(att.blobId);
    clear();
    try {
      const out = await client.download(att);
      if (out instanceof Blob) saveBlob(out, att.name);
    } catch (e) {
      fail(mailErrorMessage(e));
    } finally {
      setDownloading(null);
    }
  }

  async function unsubscribe() {
    setUnsub({ step: 'working' });
    const move = moveToJunk && folder !== 'junk' && folder !== 'spam';
    try {
      const result = await client.unsubscribe(id, move ? { moveToJunk: true } : undefined);
      if (result.status === 'done') setUnsub({ step: 'done', result, moved: move });
      else if (result.status === 'open_link') setUnsub({ step: 'link', url: result.url });
      else setUnsub({ step: 'failed', unavailable: result.status === 'unavailable' });
    } catch {
      setUnsub({ step: 'failed', unavailable: false });
    }
  }

  const showHtml = message.hasHtml && !plain && !html.error;
  const text = message.text ?? message.preview;

  return (
    <article aria-label={message.subject || '(no subject)'}>
      <BackLink href={back} label={FOLDER_LABEL[folder]} />

      <h2 className="text-[22px] font-normal leading-snug tracking-[-0.01em] text-[var(--color-ink)] [overflow-wrap:anywhere]">
        {message.subject.trim() || '(no subject)'}
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-[var(--color-rule)] py-2" role="toolbar" aria-label="Message actions">
        <Link href={composeHref(base, 'reply', id)} className={buttonClasses('secondary', 'sm')}>
          <MailIcon name="reply" size={15} /> Reply
        </Link>
        {everyone ? (
          <Link href={composeHref(base, 'replyAll', id)} className={buttonClasses('secondary', 'sm')}>
            <MailIcon name="reply-all" size={15} /> Reply all
          </Link>
        ) : null}
        <Link href={composeHref(base, 'forward', id)} className={buttonClasses('secondary', 'sm')}>
          <MailIcon name="forward" size={15} /> Forward
        </Link>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-[var(--color-rule-strong)] sm:block" />
        {folder === 'spam' ? (
          <Button size="sm" variant="secondary" onClick={() => act(() => client.move([id], 'inbox'), 'Moved to Inbox. We will remember it is not spam.')}>
            Not spam
          </Button>
        ) : null}
        <Select
          aria-label="Move this message to"
          value=""
          onChange={(e) => {
            const to = e.target.value as FolderKey;
            if (to) void act(() => client.move([id], to), `Moved to ${FOLDER_LABEL[to]}.`);
          }}
          className="!h-9 !px-2 text-[13px]"
        >
          <option value="">Move to…</option>
          {FOLDER_ORDER.filter((f) => f !== folder).map((f) => (
            <option key={f} value={f}>
              {FOLDER_LABEL[f]}
            </option>
          ))}
        </Select>
        <button
          type="button"
          aria-pressed={isFlagged}
          aria-label={isFlagged ? 'Remove star' : 'Star this message'}
          onClick={() => {
            const next = !isFlagged;
            setFlagged(next);
            void client.setFlagged([id], next).catch((e: unknown) => {
              setFlagged(!next);
              fail(mailErrorMessage(e));
            });
          }}
          className={cx('grid size-9 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-alt)]', isFlagged ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-muted)]')}
        >
          <MailIcon name="star" size={17} fill={isFlagged ? 'currentColor' : 'none'} />
        </button>
        <Button size="sm" variant="ghost" onClick={() => act(() => client.setRead([id], false), 'Marked as unread.')}>
          Mark unread
        </Button>
        <span className="ml-auto" />
        {confirmDelete ? (
          <span className="flex items-center gap-2" role="group" aria-label="Confirm delete">
            <span className="text-[13px] text-[var(--color-ink)]">Delete forever?</span>
            <Button size="sm" variant="danger" onClick={() => act(() => client.remove([id]), 'Message deleted.')}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => (folder === 'trash' ? setConfirmDelete(true) : void act(() => client.remove([id]), 'Moved to Trash.'))}
          >
            <MailIcon name="trash" size={15} /> {folder === 'trash' ? 'Delete forever' : 'Delete'}
          </Button>
        )}
      </div>

      {notice ? (
        <div className="mt-3">
          <Notice tone={notice.tone} onDismiss={clear}>
            {notice.text}
          </Notice>
        </div>
      ) : null}

      <header className="mt-4 flex gap-3">
        <Monogram text={initialsOf(message.from)} />
        <dl className="min-w-0 flex-1 space-y-0.5 text-[13px]">
          <HeaderRow label="From">{message.from ? fullAddress(message.from) : 'Unknown sender'}</HeaderRow>
          {message.replyTo.length > 0 && message.replyTo[0]?.email !== message.from?.email ? (
            <HeaderRow label="Reply">{message.replyTo.map(fullAddress).join(', ')}</HeaderRow>
          ) : null}
          <HeaderRow label="To">{message.to.length > 0 ? message.to.map(fullAddress).join(', ') : 'No recipients'}</HeaderRow>
          {message.cc.length > 0 ? <HeaderRow label="Cc">{message.cc.map(fullAddress).join(', ')}</HeaderRow> : null}
          <HeaderRow label="Date">
            <time dateTime={message.receivedAt}>{fullDate(message.receivedAt)}</time>
          </HeaderRow>
        </dl>
      </header>

      <div className="mt-5">
        {message.unsubscribe ? (
          <UnsubscribeBar message={message} state={unsub} moveToJunk={moveToJunk} onToggleMove={setMoveToJunk} onUnsubscribe={unsubscribe} />
        ) : null}

        {message.hasHtml && html.error ? (
          <div className="mb-3">
            <Notice>We could not load the formatted version of this message, so this is the plain text.</Notice>
          </div>
        ) : null}

        {showHtml ? (
          html.loading || !html.doc ? (
            <ListSkeleton rows={4} />
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-1">
              <SandboxFrame doc={html.doc} title={`Message from ${senderLabel(message.from)}`} />
            </div>
          )
        ) : (
          <PlainBody text={text} />
        )}

        {showHtml && html.doc ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--color-ink-muted)]">
            {html.remoteImagesBlocked > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <MailIcon name="shield" size={14} />
                {html.remoteImagesBlocked} remote {html.remoteImagesBlocked === 1 ? 'image' : 'images'} blocked, so the sender cannot see when you read this.
              </span>
            ) : null}
            {message.text ? (
              <button type="button" onClick={() => setPlain(true)} className="font-semibold underline">
                View as plain text
              </button>
            ) : null}
          </p>
        ) : null}
        {message.hasHtml && plain ? (
          <p className="mt-2 text-[12px]">
            <button type="button" onClick={() => setPlain(false)} className="font-semibold text-[var(--color-ink-muted)] underline">
              View formatted version
            </button>
          </p>
        ) : null}
      </div>

      <AttachmentList items={message.attachments} onDownload={download} busy={downloading} />
    </article>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent-strong)] hover:underline"
    >
      <MailIcon name="chevron-left" size={16} />
      {label}
    </Link>
  );
}
