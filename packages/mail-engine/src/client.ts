import { MailError } from "./model";
import type { MailClient, MailClientOptions } from "./model";
import { createTransport } from "./jmap/transport";
import { createHelpers } from "./ops/helpers";
import { createFolderService } from "./ops/folders";
import { createMessageOps } from "./ops/messages";
import { createSendOps } from "./ops/send";
import { draftFrom } from "./ops/compose";
import { createPush } from "./push/index";

export const DEFAULT_POLL_MS = 30_000;

type ChangeListener = (what: { folders: boolean; messages: boolean }) => void;

/**
 * The real client: JMAP to the YourTal mail proxy with a mail token (BUILD.md §5.3).
 * Pure `fetch` and timers, so it runs in the browser, in Next and in React Native.
 */
export function createMailClient(options: MailClientOptions): MailClient {
  const transport = createTransport({ getSession: options.getSession, fetch: options.fetch });
  const helpers = createHelpers(transport);
  const folders = createFolderService(transport, helpers);
  const messages = createMessageOps(transport, folders);
  const sending = createSendOps(transport, folders, {
    fetch: options.fetch,
    downloadToUri: options.downloadToUri,
  });

  const listeners = new Set<ChangeListener>();
  let closed = false;

  const push = createPush({
    transport,
    mode: options.push ?? "auto",
    pollMs: Math.max(1000, options.pollMs ?? DEFAULT_POLL_MS),
    emit(what) {
      for (const listener of [...listeners]) {
        try {
          listener(what);
        } catch {
          // a listener's bug must not break the others or the stream
        }
      }
    },
  });

  function guard<T>(run: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new MailError("unavailable", "mail client is closed"));
    return run();
  }

  return {
    folders: () => guard(() => folders.list()),
    list: (folder, page) => guard(() => messages.list(folder, page)),
    search: (text, page) => guard(() => messages.search(text, page)),
    get: (id) => guard(() => messages.get(id)),
    safeHtml: (id) => guard(() => helpers.safeHtml(id)),
    setRead: (ids, read) => guard(() => messages.setRead(ids, read)),
    setFlagged: (ids, flagged) => guard(() => messages.setFlagged(ids, flagged)),
    move: (ids, to) => guard(() => messages.move(ids, to)),
    remove: (ids) => guard(() => messages.remove(ids)),
    upload: (file) => guard(() => sending.upload(file)),
    download: (att) => guard(() => sending.download(att)),
    draftFrom: (msg, mode) => draftFrom(msg, mode, transport.peek()?.address ?? null),
    saveDraft: (d) => guard(() => sending.saveDraft(d)),
    send: (d) => guard(() => sending.send(d)),
    unsubscribe: (id, opts) => guard(() => helpers.unsubscribe(id, opts)),
    summary: (locale) => guard(async () => (await helpers.summary(locale)).summary),
    onChange(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) push.start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) push.stop();
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      push.stop();
      transport.close();
    },
  };
}
