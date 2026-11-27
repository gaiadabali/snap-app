import { createMailClient, MailError } from '@snap/mail-engine';
import type { MailClient, MailSession } from '@snap/mail-engine';
import { createMemoryMailClient } from '@snap/mail-engine/testing';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { api, ApiError, IS_DEMO } from '@/api';

import { safeFileName } from './mail-files';

/**
 * The phone's mail client: the shared engine (`@snap/mail-engine`) wired to this app.
 *
 *  - The token. The engine asks `getSession` for a 30-minute mail token, 2 minutes before
 *    it expires and once on a 401. It comes from SnapApp's own API (`POST /v1/mail/session`,
 *    with the person's session), never from YourTal directly, and the engine keeps it in
 *    memory only: nothing here stores it.
 *  - Live updates. React Native's `fetch` cannot stream, so on a phone the engine polls
 *    every 30 s while a screen is listening; the browser build can stream and uses the
 *    proxied EventSource (`push: 'auto'` picks).
 *  - Downloads. A phone saves to its cache folder through `expo-file-system`, and the
 *    headers carry the token, so it never ends up in a URL. The browser build gets a Blob.
 *  - The demo (no server URL) reads the engine's in-memory client with its fixture mail,
 *    like every other demo screen runs on fixtures and says so.
 */

/** An engine error for a failed `/v1/mail/session`, in the words the engine's hooks understand. */
export function sessionFailure(e: unknown): MailError {
  if (e instanceof MailError) return e;
  if (!(e instanceof ApiError)) return new MailError('unavailable', e instanceof Error ? e.message : undefined);
  let code: MailError['code'] = 'unavailable';
  if (e.status === 401) code = 'unauthorized';
  else if (e.code === 'not_enabled') code = 'not_enabled';
  else if (e.code === 'yourtal_not_linked') code = 'unauthorized';
  else if (e.status === 429) code = 'rate_limited';
  else if (e.status === 0) code = 'network';
  return new MailError(code, e.message, { status: e.status });
}

async function getSession(): Promise<MailSession> {
  try {
    return await api().createMailSession();
  } catch (e) {
    throw sessionFailure(e);
  }
}

/** Where a download is written: its own folder in the cache, emptied before the next one. */
const DOWNLOADS = 'mail-downloads';

export async function downloadToUri(
  url: string,
  headers: Record<string, string>,
  name: string,
): Promise<{ uri: string }> {
  try {
    const folder = new Directory(Paths.cache, DOWNLOADS);
    // Earlier downloads are cleared now, not after sharing: the receiving app may still be
    // reading the last one when its chooser closes (the same rule as the export files).
    if (folder.exists) folder.delete();
    folder.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(url, new File(folder, safeFileName(name)), {
      headers,
      idempotent: true,
    });
    return { uri: file.uri };
  } catch (cause) {
    throw new MailError('unavailable', 'could not download the attachment', { cause });
  }
}

export function createAppMailClient(): MailClient {
  if (IS_DEMO) return createMemoryMailClient();
  return createMailClient({
    getSession,
    push: 'auto',
    ...(Platform.OS === 'web' ? {} : { downloadToUri }),
  });
}
