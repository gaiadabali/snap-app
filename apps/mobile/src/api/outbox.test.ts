import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOutbox,
  enqueue,
  flush,
  loadOutbox,
  pending,
  pendingCount,
  type OutboxEntry,
  type SendOutcome,
} from './outbox';

/**
 * The outbox is what makes "this is saved and will send" true rather than a
 * reassuring sentence. It is tested here rather than through the UI because
 * the properties that matter are invisible on screen: that order is kept,
 * that a rejected write does not block the ones behind it, and that going
 * offline again stops the drain instead of burning through the queue.
 */

// A stand-in for AsyncStorage. The real one is a native module; what this
// needs to verify is that the queue SURVIVES, which an in-memory map with the
// same contract shows exactly as well.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

const entry = (id: string, path = '/v1/trips'): Omit<OutboxEntry, 'queuedAt' | 'attempts' | 'lastError'> => ({
  id,
  method: 'POST',
  path,
  body: { id },
  workspaceId: 'ws-business',
});

describe('the offline outbox', () => {
  beforeEach(async () => {
    store.clear();
    await clearOutbox();
  });

  it('keeps what was queued', async () => {
    await enqueue(entry('a'));
    await enqueue(entry('b'));
    expect(pendingCount()).toBe(2);
    expect(pending().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('writes through to storage, so a closed app does not lose the work', async () => {
    await enqueue(entry('a'));
    // The whole point: this is the state a cold start would read back.
    expect(JSON.parse(store.get('snap.outbox.v1')!)).toHaveLength(1);
  });

  it('sends in the order the writes were made', async () => {
    // Order is not cosmetic. A trip added and then deleted, replayed the
    // other way round, leaves the trip in place — a state nobody asked for.
    await enqueue(entry('first'));
    await enqueue(entry('second'));
    await enqueue(entry('third'));

    const seen: string[] = [];
    await flush(async (e) => {
      seen.push(e.id);
      return { kind: 'sent' };
    });
    expect(seen).toEqual(['first', 'second', 'third']);
    expect(pendingCount()).toBe(0);
  });

  it('retries a queued write with the SAME key it was given', async () => {
    // This is what makes a replay safe: the server recognises a write it may
    // already have applied. A regenerated key would look like a new one.
    await enqueue(entry('stable-key'));
    const keys: string[] = [];
    await flush(async (e) => {
      keys.push(e.id);
      return { kind: 'offline' };
    });
    await flush(async (e) => {
      keys.push(e.id);
      return { kind: 'sent' };
    });
    expect(keys).toEqual(['stable-key', 'stable-key']);
  });

  it('stops at the first sign of being offline again, and keeps the rest', async () => {
    await enqueue(entry('a'));
    await enqueue(entry('b'));
    await enqueue(entry('c'));

    const result = await flush(async (e) =>
      e.id === 'a' ? { kind: 'sent' } : { kind: 'offline' },
    );
    expect(result.sent).toBe(1);
    expect(result.stoppedOffline).toBe(true);
    // b and c are still queued — nothing was dropped because the signal went.
    expect(pending().map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('drops a write the SERVER rejected rather than retrying it forever', async () => {
    // A 4xx will be a 4xx every time. Keeping it blocks every write behind
    // it, so the queue would never drain again — the failure the user can see
    // is better than an app that has silently stopped sending anything.
    await enqueue(entry('bad'));
    await enqueue(entry('good'));

    const result = await flush(async (e) =>
      e.id === 'bad'
        ? ({ kind: 'rejected', message: 'That trip has no date.' } as SendOutcome)
        : { kind: 'sent' },
    );
    expect(result.sent).toBe(1);
    expect(result.failed.map((e) => e.id)).toEqual(['bad']);
    expect(result.failed[0]!.lastError).toBe('That trip has no date.');
    expect(pendingCount()).toBe(0);
  });

  it('keeps each write in the workspace it was made in', async () => {
    // A write queued in the business must not land in the household because
    // the user switched workspaces while offline.
    await enqueue({ ...entry('biz'), workspaceId: 'ws-business' });
    await enqueue({ ...entry('home'), workspaceId: 'ws-household' });
    const sentTo: Array<string | null> = [];
    await flush(async (e) => {
      sentTo.push(e.workspaceId);
      return { kind: 'sent' };
    });
    expect(sentTo).toEqual(['ws-business', 'ws-household']);
  });

  it('reads an existing queue back on a cold start', async () => {
    await enqueue(entry('survivor'));
    // Simulate a fresh process: storage persists, module state does not.
    vi.resetModules();
    const fresh = await import('./outbox');
    await fresh.loadOutbox();
    expect(fresh.pending().map((e) => e.id)).toEqual(['survivor']);
  });

  it('starts empty rather than crashing on a corrupt queue', async () => {
    store.set('snap.outbox.v1', '{not json');
    vi.resetModules();
    const fresh = await import('./outbox');
    await fresh.loadOutbox();
    // Losing queued work is bad; refusing to start the app is worse, and a
    // queue that cannot be parsed cannot be sent either.
    expect(fresh.pendingCount()).toBe(0);
  });

  it('forgets everything on sign-out', async () => {
    await enqueue(entry('mine'));
    await clearOutbox();
    expect(pendingCount()).toBe(0);
    await loadOutbox();
    expect(pendingCount()).toBe(0);
  });
});
