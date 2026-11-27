import type { FolderKey } from '@snap/mail-engine';

/**
 * Where the Mail screens live, in one place so the list, the reader, compose, the settings
 * and the notification tap cannot disagree (Expo Router; the website's `mail-routes.ts`
 * is the same idea for `/app/mail`).
 *
 *   /mail                          Inbox
 *   /mail?folder=spam              a folder: inbox, spam, junk, sent, drafts, trash
 *   /mail?q=invoice                search results
 *   /mail/{id}                     the reader
 *   /mail/compose                  new message
 *   /mail/compose?mode=reply|replyAll|forward|draft&id={id}
 *   /mail/settings                 address, statements, alerts, app passwords
 *
 * Hrefs are plain strings: the navigator's typed routes only exist once Expo has generated
 * them, and these are checked by `mail-routes.test.ts` instead.
 */
export const MAIL_HREF = '/mail';

export const FOLDER_ORDER: readonly FolderKey[] = ['inbox', 'spam', 'junk', 'sent', 'drafts', 'trash'];

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';
const MODES: readonly ComposeMode[] = ['new', 'reply', 'replyAll', 'forward', 'draft'];

/** JMAP ids are short and URL-safe. Anything else is not an id. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const isMailId = (value: string | undefined | null): value is string => !!value && ID_PATTERN.test(value);

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The folder a `?folder=` parameter names; anything else is the Inbox. */
export function parseFolder(param: string | string[] | undefined): FolderKey {
  const value = one(param);
  return (FOLDER_ORDER as readonly string[]).includes(value ?? '') ? (value as FolderKey) : 'inbox';
}

export const parseSearch = (param: string | string[] | undefined): string => (one(param) ?? '').trim().slice(0, 200);

/**
 * `null` means "not a compose URL": the screen shows the not-found state instead of loading
 * somebody else's message into a reply.
 */
export function parseCompose(
  mode: string | string[] | undefined,
  id: string | string[] | undefined,
): { mode: ComposeMode; id: string | null } | null {
  const requested = one(mode) ?? 'new';
  const found = MODES.find((m) => m === requested);
  if (!found) return null;
  if (found === 'new') return { mode: 'new', id: null };
  const messageId = one(id);
  return isMailId(messageId) ? { mode: found, id: messageId } : null;
}

export const folderHref = (folder: FolderKey): string => (folder === 'inbox' ? MAIL_HREF : `${MAIL_HREF}?folder=${folder}`);
export const searchHref = (q: string): string => `${MAIL_HREF}?q=${encodeURIComponent(q)}`;
export const messageHref = (id: string): string => `${MAIL_HREF}/${encodeURIComponent(id)}`;
export const settingsHref = (): string => `${MAIL_HREF}/settings`;
export function composeHref(mode: ComposeMode = 'new', id?: string): string {
  if (mode === 'new' || !id) return `${MAIL_HREF}/compose`;
  return `${MAIL_HREF}/compose?mode=${mode}&id=${encodeURIComponent(id)}`;
}
