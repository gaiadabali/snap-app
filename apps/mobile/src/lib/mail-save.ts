import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { mimeOrDefault, safeFileName } from './mail-files';

/**
 * Hands a downloaded attachment to the person.
 *
 * On a phone the engine saved it to the cache folder (`mail-client.ts` `downloadToUri`) and
 * this opens the system share sheet on that file: the person chooses to save it to Files or
 * Drive, or to open it in another app. Nothing is opened by SnapApp itself, so a malicious
 * attachment is never "run" from here. In the browser build the engine returns a Blob, saved
 * as a download of an opaque type so the browser never renders it as a page.
 */
export async function saveOrShare(out: Blob | { uri: string }, att: { name: string; type: string }): Promise<void> {
  const name = safeFileName(att.name);
  if (Platform.OS === 'web') {
    if (!(out instanceof Blob)) return;
    const blob = new Blob([out], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  if (out instanceof Blob) return;
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(out.uri, { mimeType: mimeOrDefault(att.type), dialogTitle: name });
}
