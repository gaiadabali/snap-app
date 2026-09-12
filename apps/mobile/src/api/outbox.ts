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

export async function enqueue(
  entry: Omit<OutboxEntry, 'queuedAt' | 'attempts' | 'lastError'>,
): Promise<void> {
  entries = [...entries, { ...entry, queuedAt: new Date().toISOString(), attempts: 0, lastError: null }];
  await persist();
}

async function remove(id: string): Promise<void> {
  entries = entries.filter((e) => e.id !== id);
  await persist();
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
  | { kind: 'rejected'; message: string };

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
 */
export async function flush(
  send: (entry: OutboxEntry) => Promise<SendOutcome>,
): Promise<{ sent: number; failed: OutboxEntry[]; stoppedOffline: boolean }> {
  await loadOutbox();
  let sent = 0;
  const failed: OutboxEntry[] = [];

  // A copy: `entries` is mutated as we go, and iterating it directly would
  // skip items as earlier ones are removed.
  for (const entry of [...entries]) {
    const outcome = await send(entry);
    if (outcome.kind === 'offline') {
      return { sent, failed, stoppedOffline: true };
    }
    if (outcome.kind === 'rejected') {
      await markFailed(entry.id, outcome.message);
      failed.push({ ...entry, lastError: outcome.message });
      await remove(entry.id);
      continue;
    }
    await remove(entry.id);
    sent += 1;
  }
  return { sent, failed, stoppedOffline: false };
}

/** Drops everything. For sign-out: a queue is one person's unsent work. */
export async function clearOutbox(): Promise<void> {
  entries = [];
  await persist();
}
