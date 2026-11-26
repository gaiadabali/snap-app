'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Attachment, Draft } from '@snap/mail-engine';
import { useMailClient, useMessage } from '@snap/mail-engine/react';

import { Button, Input, Textarea, buttonClasses } from '@/design/primitives';
import { fileSize, fullDate, mailErrorMessage } from '@/lib/panels/mail-format';
import { folderHref, type ComposeMode } from '@/lib/panels/mail-routes';
import { formatAddresses, parseAddresses, prettifyQuotedDates } from '@/lib/panels/mail-text';
import { MailIcon } from './MailIcon';
import { useMailBase } from './MailRoot';
import { ErrorBlock, ListSkeleton, Notice, flashNotice } from './MailUi';

/** The proxy accepts uploads up to 25 MB (BUILD.md §4.3). */
export const MAX_UPLOAD_BYTES = 25 * 1000 * 1000;
const MAX_RECIPIENTS = 10;

const TITLE: Record<ComposeMode, string> = {
  new: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
  draft: 'Edit draft',
};

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-rule)] py-1.5">
      <label htmlFor={id} className="w-16 shrink-0 text-[13px] font-semibold text-[var(--color-ink-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

const bare = '!h-9 min-w-0 flex-1 !border-0 !bg-transparent !px-0 focus:!outline-none';

export function ComposeForm({ mode, initial }: { mode: ComposeMode; initial: Draft }) {
  const client = useMailClient();
  const base = useMailBase();
  const router = useRouter();
  const body = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState(formatAddresses(initial.to));
  const [cc, setCc] = useState(formatAddresses(initial.cc));
  const [bcc, setBcc] = useState(formatAddresses(initial.bcc));
  const [showCc, setShowCc] = useState((initial.cc?.length ?? 0) > 0 || (initial.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [files, setFiles] = useState<Attachment[]>(initial.attachments ?? []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(initial.draftId);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sending'>('idle');
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [askSubject, setAskSubject] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setProblem(null);
    setAskSubject(false);
  };

  // A reply starts typing above the quote; a forward and a new message start at To.
  useEffect(() => {
    if (mode === 'reply' || mode === 'replyAll') {
      body.current?.focus();
      body.current?.setSelectionRange(0, 0);
    }
  }, [mode]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** The draft as typed, or the reason it cannot be sent. */
  function build(forSend: boolean): { draft: Draft } | { error: string } {
    const t = parseAddresses(to);
    const c = parseAddresses(cc);
    const b = parseAddresses(bcc);
    const bad = [...t.invalid, ...c.invalid, ...b.invalid];
    if (bad.length > 0) {
      return { error: `${bad.length === 1 ? 'This is not an email address' : 'These are not email addresses'}: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}` };
    }
    if (forSend) {
      const all = new Set([...t.ok, ...c.ok, ...b.ok].map((a) => a.email.toLowerCase()));
      if (all.size === 0) return { error: 'Add at least one recipient.' };
      if (all.size > MAX_RECIPIENTS) return { error: `You can send to at most ${MAX_RECIPIENTS} people in one message.` };
    }
    const draft: Draft = { to: t.ok, subject: subject.trim(), text };
    if (c.ok.length > 0) draft.cc = c.ok;
    if (b.ok.length > 0) draft.bcc = b.ok;
    if (files.length > 0) draft.attachments = files;
    if (draftId) draft.draftId = draftId;
    if (initial.inReplyTo) draft.inReplyTo = initial.inReplyTo;
    if (initial.references) draft.references = initial.references;
    return { draft };
  }

  async function saveDraft() {
    const built = build(false);
    if ('error' in built) return setProblem(built.error);
    setPhase('saving');
    setProblem(null);
    try {
      const { draftId: id } = await client.saveDraft(built.draft);
      setDraftId(id);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setProblem(mailErrorMessage(e));
    } finally {
      setPhase('idle');
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (phase !== 'idle' || uploading.length > 0) return;
    const built = build(true);
    if ('error' in built) return setProblem(built.error);
    if (built.draft.subject === '' && !askSubject) {
      setAskSubject(true);
      return;
    }
    setPhase('sending');
    setProblem(null);
    try {
      await client.send(built.draft);
      setDirty(false);
      flashNotice('Message sent.');
      router.push(folderHref(base, 'sent'));
    } catch (err) {
      setProblem(mailErrorMessage(err));
      setPhase('idle');
    }
  }

  async function attach(list: FileList | null) {
    if (!list) return;
    setProblem(null);
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setProblem(`${file.name} is ${fileSize(file.size)}. Attachments can be up to ${fileSize(MAX_UPLOAD_BYTES)} each.`);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const att = await client.upload({ kind: 'blob', blob: file, name: file.name });
        setFiles((f) => [...f, att]);
        setDirty(true);
        setSaved(false);
      } catch (e) {
        setProblem(`${file.name}: ${mailErrorMessage(e)}`);
      } finally {
        setUploading((u) => {
          const at = u.indexOf(file.name);
          return at < 0 ? u : [...u.slice(0, at), ...u.slice(at + 1)];
        });
      }
    }
    if (picker.current) picker.current.value = '';
  }

  async function discard() {
    if (dirty && !askDiscard) {
      setAskDiscard(true);
      return;
    }
    setDirty(false);
    if (draftId && mode === 'draft') {
      try {
        await client.remove([draftId]);
      } catch {
        // The draft stays in Drafts; leaving is still what the person asked for.
      }
    }
    router.push(folderHref(base, mode === 'draft' ? 'drafts' : 'inbox'));
  }

  const busy = phase !== 'idle';

  return (
    <form onSubmit={send} aria-labelledby="compose-title" noValidate>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="compose-title" className="text-[18px] font-semibold text-[var(--color-ink)]">
          {TITLE[mode]}
        </h2>
        <span role="status" className="text-[13px] text-[var(--color-ink-muted)]">
          {phase === 'saving' ? 'Saving…' : saved ? 'Draft saved' : ''}
        </span>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-4 pb-4 pt-2">
        <Row id="compose-to" label="To">
          <Input
            id="compose-to"
            type="text"
            inputMode="email"
            autoComplete="off"
            autoFocus={mode === 'new' || mode === 'forward' || mode === 'draft'}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              touch();
            }}
            placeholder="name@example.com, another@example.com"
            className={bare}
          />
          {!showCc ? (
            <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-[13px] font-semibold text-[var(--color-accent-strong)] hover:underline">
              Cc / Bcc
            </button>
          ) : null}
        </Row>
        {showCc ? (
          <>
            <Row id="compose-cc" label="Cc">
              <Input id="compose-cc" type="text" inputMode="email" autoComplete="off" value={cc} onChange={(e) => { setCc(e.target.value); touch(); }} className={bare} />
            </Row>
            <Row id="compose-bcc" label="Bcc">
              <Input id="compose-bcc" type="text" inputMode="email" autoComplete="off" value={bcc} onChange={(e) => { setBcc(e.target.value); touch(); }} className={bare} />
            </Row>
          </>
        ) : null}
        <Row id="compose-subject" label="Subject">
          <Input id="compose-subject" type="text" autoComplete="off" maxLength={300} value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} className={bare} />
        </Row>

        <label htmlFor="compose-body" className="sr-only">
          Message
        </label>
        <Textarea
          id="compose-body"
          ref={body}
          rows={14}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            touch();
          }}
          className="mt-3 w-full resize-y !border-0 !bg-transparent !px-0 text-[15px] leading-relaxed focus:!outline-none"
        />

        {files.length > 0 || uploading.length > 0 ? (
          <ul aria-label="Attachments" className="mt-2 flex flex-wrap gap-2 border-t border-[var(--color-rule)] pt-3">
            {files.map((f, i) => (
              <li key={`${f.blobId}-${i}`} className="flex max-w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[13px]">
                <MailIcon name="paperclip" size={14} />
                <span className="min-w-0 truncate font-medium text-[var(--color-ink)]">{f.name}</span>
                <span className="shrink-0 text-[var(--color-ink-muted)] tabular">{fileSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFiles((cur) => cur.filter((_, at) => at !== i));
                    touch();
                  }}
                  aria-label={`Remove ${f.name}`}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]"
                >
                  <MailIcon name="x" size={14} />
                </button>
              </li>
            ))}
            {uploading.map((name, i) => (
              <li key={`up-${name}-${i}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink-muted)]">
                <MailIcon name="paperclip" size={14} />
                <span className="truncate">Uploading {name}…</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {problem ? (
        <div className="mt-3">
          <Notice tone="error">{problem}</Notice>
        </div>
      ) : null}
      {askSubject ? (
        <div className="mt-3">
          <Notice>This message has no subject. Press Send again to send it anyway.</Notice>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || uploading.length > 0}>
          <MailIcon name="send" size={16} />
          {phase === 'sending' ? 'Sending…' : 'Send'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={saveDraft}>
          Save draft
        </Button>
        <input
          ref={picker}
          id="compose-files"
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => void attach(e.target.files)}
          aria-label="Attach files"
        />
        <label htmlFor="compose-files" className={buttonClasses('ghost', 'md', 'cursor-pointer')}>
          <MailIcon name="paperclip" size={16} />
          Attach files
        </label>
        <span className="ml-auto flex items-center gap-2">
          {askDiscard ? (
            <>
              <span className="text-[13px] text-[var(--color-ink)]">Discard this message?</span>
              <Button type="button" variant="danger" size="sm" onClick={discard}>
                Discard
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAskDiscard(false)}>
                Keep editing
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={discard}>
              Discard
            </Button>
          )}
        </span>
      </div>
    </form>
  );
}

/** Loads the message a reply, forward or draft starts from, then hands a draft to the form. */
export function Compose({ mode, id }: { mode: ComposeMode; id: string | null }) {
  const client = useMailClient();
  const base = useMailBase();
  const { message, loading, error } = useMessage(mode === 'new' ? null : id);

  const initial = useMemo<Draft | null>(() => {
    if (mode === 'new') return { to: [], subject: '', text: '' };
    if (!message) return null;
    if (mode === 'draft') {
      const draft: Draft = { draftId: message.id, to: message.to, subject: message.subject, text: message.text ?? '' };
      if (message.cc.length > 0) draft.cc = message.cc;
      const kept = message.attachments.filter((a) => !a.inline);
      if (kept.length > 0) draft.attachments = kept;
      const parent = message.references[message.references.length - 1];
      if (parent) {
        draft.references = message.references;
        draft.inReplyTo = parent;
      }
      return draft;
    }
    const draft = client.draftFrom(message, mode);
    return { ...draft, text: prettifyQuotedDates(draft.text, fullDate) };
  }, [client, mode, message]);

  if (initial) return <ComposeForm key={`${mode}-${id ?? 'new'}`} mode={mode} initial={initial} />;
  if (error) {
    return (
      <div>
        <Link href={folderHref(base, 'inbox')} className="mb-3 inline-flex text-[13px] font-semibold text-[var(--color-accent-strong)] hover:underline">
          Back to Inbox
        </Link>
        <ErrorBlock message={error.code === 'rejected' ? 'The message you were replying to is not here any more.' : mailErrorMessage(error)} />
      </div>
    );
  }
  return loading || !message ? <ListSkeleton rows={4} /> : null;
}
