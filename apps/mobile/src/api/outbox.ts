import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Writes that could not be sent yet.
 *
 * This app is used at truck stops, in loading docks and on the Hume at 2am.
 * "No signal" is not an error state here, it is Tuesday — so a write made
 * offline has to survive being made offline, including the app being closed
 * and the phone going flat before it comes back.
 *
 * Persisted to storage on every change rather than held in memory: an outbox
 * that only lives in memory loses exactly the work it exists to protect, and
 * does so silently.
 *
 * Every entry carries the idempotency key it will be sent with, minted ONCE
 * when the write is queued and never regenerated. That is what makes a replay
 * safe: if the phone dies after the server accepted the write but before the
 * response arrived, the retry carries the same key and the server answers
 * with the original outcome instead of doing it twice.
 */

const KEY = 'snap.outbox.v1';

export type OutboxEntry = {
  /** Also the Idempotency-Key. Minted once; never regenerated on retry. */
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  /** The workspace the write belongs to — NOT whichever one is active when it
   *  eventually sends. A trip queued in the business must not land in the
   *  household because the user switched workspaces while offline. */
  workspaceId: string | null;
  queuedAt: string;
  attempts: number;
  /** The last thing the server or the network said, for showing the user. */
  lastError: string | null;
  /**
   * `'capture'` for a queued photo, absent for a plain JSON write.
   *
   * A capture carries the same three-step exchange a live one does — register,
   * PUT the bytes, wait — so its flush path is different and the drain needs
   * to know which it is holding. The JSON body is the `createCapture`
   * request; the bytes live under their own storage key (see
   * `queueCapture`), because serialising megabytes through the same JSON as
   * every other entry would make each queue rewrite re-encode every photo
   * in the queue.
   */
  kind?: 'capture';
};

const BYTES_PREFIX = 'snap.outbox.v1.bytes.';

/** One page's image, as it was taken. */
export type CapturePageBytes = { mimeType: string; bytes: ArrayBuffer };

/** What `queueCapture` is handed: the request and the bytes behind it. */
export type CaptureToQueue = {
  /** The Idempotency-Key for the eventual `createCapture`. Minted once here. */
  id: string;
  /** Exactly the body `createCapture` will be replayed with. */
  request: unknown;
  /** One entry per page, in the request's page order. */
  pages: CapturePageBytes[];
};

let entries: OutboxEntry[] = [];
let loaded = false;

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable. The entry stays in memory and will still
    // be attempted this session; it is one lost queued write in an already
    // broken situation, not a crash on top of it.
  }
}

/** Reads the queue from storage. Safe to call repeatedly. */
export async function loadOutbox(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    entries = Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    // Unreadable or corrupt. Starting empty loses queued work, which is bad —
    // but refusing to start the app is worse, and a queue we cannot parse is
    // one we cannot send either.
    entries = [];
  }
}

export function pending(): readonly OutboxEntry[] {
  return entries;
}

export function pendingCount(): number {
  return entries.length;
}

/**
 * How many writes — plain or captured — are waiting to send.
 *
 * The async shape is deliberate: a screen calling this on mount has not
 * necessarily seen `loadOutbox` run yet, and answering from unloaded module
 * state would show "nothing waiting" while last session's queue sits in
 * storage unread.
 */
export async function pendingWrites(): Promise<number> {
  await loadOutbox();
  return pendingCount();
}

/* ── Base64, by hand ─────────────────────────────────────────────────────
 *
 * AsyncStorage stores strings, so image bytes go through base64. Neither
 * `btoa` nor `Buffer` can be assumed across Hermes, a browser and Node's
 * test runner, so both directions are spelled out here — chunked, because a
 * one-call `String.fromCharCode(...bytes)` blows the argument limit on a
 * multi-megabyte photograph. */

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    out += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/**
 * Queues a capture taken offline: the `createCapture` request in the entry's
 * JSON body, the image bytes under a storage key of their own.
 *
 * The bytes key is derived from the entry's id, which is also the
 * Idempotency-Key — so a replay after the phone died mid-flush re-registers
 * with the SAME key and the server answers with the capture it already made,
 * and the bytes are read fresh for the uploads. Nothing is regenerated on
 * retry, ever.
 *
 * Oldest-first sending falls out of `enqueue` appending to the end of the
 * same array every other queued write uses — there is no second queue, and
 * a capture must not overtake a trip the user made before photographing
 * anything (order is the only thing keeping a delete-then-recreate sane).
 */
export async function queueCapture(capture: CaptureToQueue, workspaceId: string | null): Promise<void> {
  const stored = capture.pages.map((page) => ({
    mimeType: page.mimeType,
    base64: bytesToBase64(page.bytes),
  }));
  try {
    await AsyncStorage.setItem(BYTES_PREFIX + capture.id, JSON.stringify(stored));
  } catch {
    // Storage refused the image. Queueing a capture WITHOUT its bytes would
    // register a document the server can never show — the exact broken
    // record the plain-write outbox refuses to make — so the honest outcome
    // is that this capture is not queued at all and the user is told so by
    // the normal capture error path.
    throw new Error('There is not enough room on this device to keep the photo for sending. Free up some space and take it again.');
  }
  await enqueue({
    id: capture.id,
    method: 'POST',
    path: '/v1/captures',
    body: capture.request,
    workspaceId,
    kind: 'capture',
  });
}

/**
 * Reads a queued capture's image bytes back. Returns null when there are
 * none — either nothing was ever queued under this id, or storage has lost
 * them (see `remove`, which deletes the key when the entry goes).
 */
export async function loadCaptureBytes(id: string): Promise<CapturePageBytes[] | null> {
  try {
    const raw = await AsyncStorage.getItem(BYTES_PREFIX + id);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (p): p is { mimeType: string; base64: string } =>
          typeof (p as { mimeType?: unknown })?.mimeType === 'string' &&
          typeof (p as { base64?: unknown })?.base64 === 'string',
      )
      .map((p) => ({ mimeType: p.mimeType, bytes: base64ToBytes(p.base64) }));
  } catch {
    // Unreadable is as good as absent: a flush cannot send bytes it cannot
    // read, and the drain turns that into a rejection the user can see.
    return null;
  }
}

async function removeCaptureBytes(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(BYTES_PREFIX + id);
  } catch {
    // An orphaned bytes key is storage waste, not lost work — the entry that
    // points at it is already gone. Not worth failing anything over.
  }
}

export async function enqueue(
  entry: Omit<OutboxEntry, 'queuedAt' | 'attempts' | 'lastError'>,
): Promise<void> {
  entries = [...entries, { ...entry, queuedAt: new Date().toISOString(), attempts: 0, lastError: null }];
  await persist();
}

async function remove(id: string): Promise<void> {
  const wasCapture = entries.some((e) => e.id === id && e.kind === 'capture');
  entries = entries.filter((e) => e.id !== id);
  await persist();
  // A queued photo's bytes must not outlive the entry that points at them:
  // an entry drained with bytes still in storage is dead weight the next
  // sign-out would never explain. A plain write has no bytes key at all.
  if (wasCapture) await removeCaptureBytes(id);
}

async function markFailed(id: string, message: string): Promise<void> {
  entries = entries.map((e) =>
    e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e,
  );
  await persist();
}

/** What a send attempt did, so the caller can decide whether to keep going. */
export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'offline' }
  | { kind: 'rejected'; message: string }
  | { kind: 'retry'; message: string };

/**
 * Sends everything queued, oldest first, and stops at the first sign of being
 * offline again.
 *
 * ORDER MATTERS and is preserved. Writes made offline are not independent —
 * a trip added and then deleted, a budget set twice — and replaying them out
 * of order produces a state the user never asked for. One at a time, in
 * sequence, for the same reason.
 *
 * A write the SERVER rejects (a 4xx) is dropped rather than retried forever.
 * It will be rejected identically every time, and a queue that never drains
 * blocks every write behind it. What the user sees is the failure, which is
 * the honest outcome; what they must not get is an app that silently stops
 * sending anything.
 *
 * `'retry'` is NOT `'rejected'`, even though both arrive as a 4xx off the
 * wire. `docs/ON-DEVICE.md` §7.2 (OD-11): a correction sent for a capture
 * whose extraction has not produced a document yet answers 409
 * `document_not_ready`, and that is a state the outbox WILL see resolve on
 * its own — extraction finishes independently of the phone. Treating it like
 * any other 4xx and dropping it is exactly how a first implementation loses a
 * human's correction: the person edited a field, closed the app, and the edit
 * is gone because it happened to race the worker. So it stays queued, at its
 * original position, and is tried again on the next drain — but it does NOT
 * stop the whole flush the way `'offline'` does, because a temporarily
 * not-ready CAPTURE is not evidence the connection is down, and every other
 * queued write for every other resource has no reason to wait behind it.
 */
export async function flush(
  send: (entry: OutboxEntry) => Promise<SendOutcome>,
): Promise<{ sent: number; failed: OutboxEntry[]; retrying: OutboxEntry[]; stoppedOffline: boolean }> {
  await loadOutbox();
  let sent = 0;
  const failed: OutboxEntry[] = [];
  const retrying: OutboxEntry[] = [];

  // A copy: `entries` is mutated as we go, and iterating it directly would
  // skip items as earlier ones are removed.
  for (const entry of [...entries]) {
    const outcome = await send(entry);
    if (outcome.kind === 'offline') {
      return { sent, failed, retrying, stoppedOffline: true };
    }
    if (outcome.kind === 'rejected') {
      await markFailed(entry.id, outcome.message);
      failed.push({ ...entry, lastError: outcome.message });
      await remove(entry.id);
      continue;
    }
    if (outcome.kind === 'retry') {
      // Deliberately NOT removed. `attempts`/`lastError` are updated so a UI
      // can say what is happening, but the entry stays queued in place for
      // the next drain — the whole point being that this is not a failure.
      await markFailed(entry.id, outcome.message);
      retrying.push({ ...entry, lastError: outcome.message });
      continue;
    }
    await remove(entry.id);
    sent += 1;
  }
  return { sent, failed, retrying, stoppedOffline: false };
}

/** Drops everything. For sign-out: a queue is one person's unsent work. */
export async function clearOutbox(): Promise<void> {
  entries = [];
  await persist();
  // Whatever bytes are queued go with the queue — a sign-out that left
  // photographs behind would keep another person's receipts on the device.
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(BYTES_PREFIX)));
  } catch {
    // Storage that will not list its keys is the same broken storage that
    // would not accept the queue; the writes it holds cannot be sent by
    // this session either way.
  }
}
