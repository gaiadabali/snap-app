import type { FolderKey } from '@snap/mail-engine';

/**
 * The URLs of the mail screens, in one place so the real route (`/app/mail`) and the
 * development preview (`/mail-preview`) cannot disagree.
 *
 *   /app/mail                      Inbox
 *   /app/mail/{folder}             a folder: inbox, spam, junk, sent, drafts, trash
 *   /app/mail/search?q=            search results
 *   /app/mail/message/{id}         the reader
 *   /app/mail/compose              new message
 *   /app/mail/compose?mode=reply|replyAll|forward|draft&id={id}
 *   /app/mail/settings             address, statements, alerts, app passwords
 */
export const MAIL_BASE = '/app/mail';

export const FOLDER_ORDER: readonly FolderKey[] = ['inbox', 'spam', 'junk', 'sent', 'drafts', 'trash'];

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';

export type MailRoute =
  | { view: 'folder'; folder: FolderKey }
  | { view: 'search'; q: string }
  | { view: 'message'; id: string }
  | { view: 'compose'; mode: ComposeMode; id: string | null }
  | { view: 'settings' };

/** JMAP ids are short and URL-safe. Anything else is not an id. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const isMailId = (value: string): boolean => ID_PATTERN.test(value);

const isFolder = (value: string): value is FolderKey => (FOLDER_ORDER as readonly string[]).includes(value);

const MODES: readonly ComposeMode[] = ['new', 'reply', 'replyAll', 'forward', 'draft'];

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `null` means "not a mail URL" (the page answers 404). */
export function resolveMailRoute(segments: string[] | undefined, query: Query = {}): MailRoute | null {
  const parts = segments ?? [];
  if (parts.length === 0) return { view: 'folder', folder: 'inbox' };
  const [head, second] = parts;
  if (parts.length === 1 && head !== undefined) {
    if (isFolder(head)) return { view: 'folder', folder: head };
    if (head === 'settings') return { view: 'settings' };
    if (head === 'search') return { view: 'search', q: (one(query.q) ?? '').slice(0, 200) };
    if (head === 'compose') {
      const requested = one(query.mode) ?? 'new';
      const mode = MODES.find((m) => m === requested);
      if (!mode) return null;
      const id = one(query.id) ?? null;
      if (mode === 'new') return { view: 'compose', mode, id: null };
      if (id === null || !isMailId(id)) return null;
      return { view: 'compose', mode, id };
    }
    return null;
  }
  if (parts.length === 2 && head === 'message' && second !== undefined && isMailId(second)) {
    return { view: 'message', id: second };
  }
  return null;
}

export const folderHref = (base: string, folder: FolderKey): string => (folder === 'inbox' ? base : `${base}/${folder}`);
export const messageHref = (base: string, id: string): string => `${base}/message/${encodeURIComponent(id)}`;
export const searchHref = (base: string, q: string): string => `${base}/search?q=${encodeURIComponent(q)}`;
export const settingsHref = (base: string): string => `${base}/settings`;
export function composeHref(base: string, mode: ComposeMode = 'new', id?: string): string {
  if (mode === 'new' || !id) return `${base}/compose`;
  return `${base}/compose?mode=${mode}&id=${encodeURIComponent(id)}`;
}
