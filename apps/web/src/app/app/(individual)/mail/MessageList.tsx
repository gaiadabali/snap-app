'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderKey, MessageSummary } from '@snap/mail-engine';
import { useMailClient, useMessageList } from '@snap/mail-engine/react';

import { Button, Empty, Select, cx } from '@/design/primitives';
import { FOLDER_EMPTY, FOLDER_HINT, FOLDER_LABEL, mailErrorMessage } from '@/lib/panels/mail-format';
import { FOLDER_ORDER, composeHref, messageHref } from '@/lib/panels/mail-routes';
import { MailIcon } from './MailIcon';
import { useMailBase } from './MailRoot';
import { ErrorBlock, ListSkeleton, Notice, useNotice } from './MailUi';
import { MessageRow } from './MessageRow';
import { SpamBanner } from './SpamBanner';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A folder, or search results. One component so both share selection, bulk actions and paging. */
export function MessageList({ folder, search }: { folder?: FolderKey; search?: string }) {
  const client = useMailClient();
  const base = useMailBase();
  const source = useMemo(() => (folder ? folder : { search: search ?? '' }), [folder, search]);
  const list = useMessageList(source);
  const { notice, say, fail, clear } = useNotice();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectAll = useRef<HTMLInputElement>(null);

  const inTrash = folder === 'trash';
  const ids = useMemo(() => new Set(list.items.map((m) => m.id)), [list.items]);
  // Forget anything that is no longer in the list (moved, deleted, refreshed away).
  const chosen = useMemo(() => [...selected].filter((id) => ids.has(id)), [selected, ids]);
  const allChosen = list.items.length > 0 && chosen.length === list.items.length;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);
  useEffect(() => {
    // A new folder or query starts with nothing selected.
    setSelected(new Set());
    setConfirmDelete(false);
  }, [folder, search]);

  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    clear();
    try {
      await task();
      say(done);
      setSelected(new Set());
      setConfirmDelete(false);
    } catch (e) {
      fail(mailErrorMessage(e));
    } finally {
      list.refresh();
      setBusy(false);
    }
  }

  const count = chosen.length;
  const noun = plural(count, 'message', 'messages');

  const moveTargets = FOLDER_ORDER.filter((f) => f !== folder);

  const title = folder ? FOLDER_LABEL[folder] : 'Search results';
  const hint = folder ? FOLDER_HINT[folder] : search ? `Matches for “${search}” across every folder.` : undefined;

  return (
    <section aria-labelledby="mail-list-title">
      <div className="mb-3">
        <h2 id="mail-list-title" className="text-[18px] font-semibold text-[var(--color-ink)]">
          {title}
          {list.total > 0 ? (
            <span className="ml-2 font-mono text-[13px] font-normal text-[var(--color-ink-muted)] tabular">{list.total}</span>
          ) : null}
        </h2>
        {hint ? <p className="mt-0.5 max-w-[68ch] text-[14px] text-[var(--color-ink-muted)]">{hint}</p> : null}
      </div>

      {folder === 'spam' ? <SpamBanner /> : null}

      <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-[var(--color-rule)] py-1">
        <label className="flex items-center gap-2 pl-1.5 text-[13px] text-[var(--color-ink-muted)] sm:pl-3">
          <input
            ref={selectAll}
            type="checkbox"
            checked={allChosen}
            disabled={list.items.length === 0}
            onChange={(e) => setSelected(e.target.checked ? new Set(list.items.map((m) => m.id)) : new Set())}
            aria-label="Select all messages shown"
            className="size-4 accent-[var(--color-accent-strong)]"
          />
          <span className={cx(count === 0 && 'sr-only')}>{count} selected</span>
        </label>
        {count > 0 ? (
          confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
              <span className="text-[14px] text-[var(--color-ink)]">
                Delete {count} {noun} forever?
              </span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => client.remove(chosen), `Deleted ${count} ${noun}.`)}>
                Delete forever
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions for selected messages">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => client.setRead(chosen, true), `Marked ${count} ${noun} as read.`)}>
                Mark read
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => client.setRead(chosen, false), `Marked ${count} ${noun} as unread.`)}>
                Mark unread
              </Button>
              <Select
                aria-label="Move selected messages to"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const to = e.target.value as FolderKey;
                  if (to) void run(() => client.move(chosen, to), `Moved ${count} ${noun} to ${FOLDER_LABEL[to]}.`);
                }}
                className="!h-9 !px-2 text-[13px]"
              >
                <option value="">Move to…</option>
                {moveTargets.map((f) => (
                  <option key={f} value={f}>
                    {FOLDER_LABEL[f]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => (inTrash ? setConfirmDelete(true) : void run(() => client.remove(chosen), `Moved ${count} ${noun} to Trash.`))}
              >
                <MailIcon name="trash" size={15} />
                {inTrash ? 'Delete forever' : 'Delete'}
              </Button>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={() => list.refresh()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <MailIcon name="refresh" size={15} />
            Refresh
          </button>
        )}
      </div>

      {notice ? (
        <div className="mb-2">
          <Notice tone={notice.tone} onDismiss={clear}>
            {notice.text}
          </Notice>
        </div>
      ) : null}

      {list.error && list.items.length === 0 ? (
        <ErrorBlock message={mailErrorMessage(list.error)} onRetry={() => list.refresh()} />
      ) : list.loading && list.items.length === 0 ? (
        <ListSkeleton />
      ) : list.items.length === 0 ? (
        <Empty
          title={folder ? FOLDER_EMPTY[folder] : search ? `Nothing found for “${search}”.` : 'Type something to search your mail.'}
          body={!folder && search ? 'Try a sender’s name or a word from the subject.' : undefined}
          action={
            folder === 'sent' || folder === 'drafts' ? (
              <Link className="text-[14px] font-semibold text-[var(--color-accent-strong)] underline" href={composeHref(base)}>
                Write a message
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {list.error ? (
            <div className="mb-2">
              <Notice tone="error">{mailErrorMessage(list.error)}</Notice>
            </div>
          ) : null}
          <ul className="divide-y divide-[var(--color-rule)] border-b border-[var(--color-rule)]" aria-busy={list.loading}>
            {list.items.map((m: MessageSummary) => (
              <MessageRow
                key={m.id}
                message={m}
                href={m.folder === 'drafts' ? composeHref(base, 'draft', m.id) : messageHref(base, m.id)}
                selected={selected.has(m.id)}
                onSelect={(on) => toggle(m.id, on)}
                onFlag={(on) => void client.setFlagged([m.id], on).then(() => list.refresh(), (e: unknown) => fail(mailErrorMessage(e)))}
                showFolder={!folder}
              />
            ))}
          </ul>
          {list.items.length < list.total ? (
            <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-[var(--color-ink-muted)]">
              <span className="tabular">
                Showing {list.items.length} of {list.total}
              </span>
              <Button variant="secondary" size="sm" onClick={() => list.loadMore()} disabled={list.loading}>
                Show more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
