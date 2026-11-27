/**
 * Pure rules for files that come off a phone's filesystem or a mail download, kept apart
 * from the `expo-*` calls so they can be tested under plain Vitest.
 */

/** The proxy accepts uploads up to 25 MB (spambank/BUILD.md §4.3). */
export const MAX_ATTACHMENT_BYTES = 25 * 1000 * 1000;
/** At most 10 recipients in one message (the proxy's rule); one place says so. */
export const MAX_RECIPIENTS = 10;
/** At most this many app passwords per mailbox, each named with 1 to 40 characters (BUILD.md §4.10). */
export const MAX_APP_PASSWORDS = 5;
export const APP_PASSWORD_NAME_MAX = 40;

/**
 * A file name safe to create on the phone from a name a SENDER chose: no path parts, no
 * control characters, no leading dots, and never empty. The attachment keeps its own
 * extension; the name is cut to a length every Android filesystem accepts.
 */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (base === '') return 'attachment';
  if (base.length <= 100) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : '';
  return `${base.slice(0, 100 - ext.length)}${ext}`;
}

/**
 * The picked file's MIME type, or a safe default. `expo-document-picker` can answer without
 * one (a file from a provider that does not say), and the proxy wants a content type.
 */
export function mimeOrDefault(type: string | null | undefined): string {
  const t = (type ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(t) ? t : 'application/octet-stream';
}
