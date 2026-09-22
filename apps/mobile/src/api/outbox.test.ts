import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOutbox,
  enqueue,
  flush,
  loadCaptureBytes,
  loadOutbox,
  pending,
  pendingCount,
  pendingWrites,
  queueCapture,
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

  it('keeps a write queued on "retry", and does NOT stop the drain for it', async () => {
    // OD-11 (`docs/ON-DEVICE.md` §7.2): a correction rejected with
    // `document_not_ready` is a state that resolves on its own, not a dead
    // write and not evidence the connection is down. Unlike `'rejected'`, it
    // must survive the flush; unlike `'offline'`, it must not block whatever
    // comes after it in the queue.
    await enqueue(entry('not-ready-yet'));
    await enqueue(entry('unrelated-write'));

    const seen: string[] = [];
    const result = await flush(async (e) => {
      seen.push(e.id);
      if (e.id === 'not-ready-yet') return { kind: 'retry', message: 'document_not_ready' };
      return { kind: 'sent' };
    });

    // Both were attempted — a retry does not halt the drain the way offline does.
    expect(seen).toEqual(['not-ready-yet', 'unrelated-write']);
    expect(result.stoppedOffline).toBe(false);
    expect(result.sent).toBe(1);
    expect(result.retrying.map((e) => e.id)).toEqual(['not-ready-yet']);
    // Still queued, at its position, for the next drain — NOT dropped the way
    // a `'rejected'` write is.
    expect(pending().map((e) => e.id)).toEqual(['not-ready-yet']);
  });

  it('replays a "retry" write with the SAME key until it actually sends', async () => {
    await enqueue(entry('stable-key'));
    const keys: string[] = [];

    await flush(async (e) => {
      keys.push(e.id);
      return { kind: 'retry', message: 'document_not_ready' };
    });
    await flush(async (e) => {
      keys.push(e.id);
      return { kind: 'retry', message: 'document_not_ready' };
    });
    await flush(async (e) => {
      keys.push(e.id);
      return { kind: 'sent' };
    });

    // The same Idempotency-Key on every attempt — a regenerated one would look
    // like a new write to the server and defeat the whole point of retrying.
    expect(keys).toEqual(['stable-key', 'stable-key', 'stable-key']);
    expect(pendingCount()).toBe(0);
  });

  it('keeps a photo taken offline, and flush sends the SAME bytes', async () => {
    // The round-trip that matters: a capture registered offline must queue
    // with its image bytes, flush them to the server, and drain.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 13]).buffer;
    const id = 'cap_offline';
    await queueCapture(
      {
        id,
        request: {
          pages: [{ sha256: 'abc123', mimeType: 'image/jpeg', byteSize: 7 }],
          capturedAt: '2026-09-22T02:00:00.000Z',
        },
        pages: [{ mimeType: 'image/jpeg', bytes }],
      },
      'ws-business',
    );
    expect(pendingCount()).toBe(1);
    expect(pending()[0]!.kind).toBe('capture');
    // The bytes are in the durable storage, not just in memory.
    expect(store.get('snap.outbox.v1.bytes.cap_offline')).toBeTruthy();

    const created: Array<{ pages: unknown; bytes: ArrayBuffer[] }> = [];
    const result = await flush(async (e) => {
      const stored = await loadCaptureBytes(e.id);
      if (!stored) return { kind: 'rejected', message: 'no bytes' };
      created.push({ pages: e.body, bytes: stored.map((p) => p.bytes) });
      return { kind: 'sent' };
    });

    expect(result.sent).toBe(1);
    expect(pendingCount()).toBe(0);
    // The server create was called with what was queued...
    expect(created[0]!.pages).toEqual({
      pages: [{ sha256: 'abc123', mimeType: 'image/jpeg', byteSize: 7 }],
      capturedAt: '2026-09-22T02:00:00.000Z',
    });
    // ...and the bytes handed over decode to exactly what was taken.
    expect(new Uint8Array(created[0]!.bytes[0])).toEqual(new Uint8Array(bytes));
    // Drained means drained: the stored bytes went with it.
    expect(store.get('snap.outbox.v1.bytes.cap_offline')).toBeUndefined();
  });

  it('survives a process restart with its bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await queueCapture(
      {
        id: 'cap_restart',
        request: {
          pages: [{ sha256: 'd1', mimeType: 'image/jpeg', byteSize: 4 }],
          capturedAt: '2026-09-22T03:00:00.000Z',
        },
        pages: [{ mimeType: 'image/jpeg', bytes }],
      },
      'ws-business',
    );
    // A fresh process: storage persists, module state does not.
    vi.resetModules();
    const fresh = await import('./outbox');
    await fresh.loadOutbox();
    expect(fresh.pendingCount()).toBe(1);
    const stored = await fresh.loadCaptureBytes('cap_restart');
    expect(stored).not.toBeNull();
    expect(stored![0]!.mimeType).toBe('image/jpeg');
    expect(new Uint8Array(stored![0]!.bytes)).toEqual(new Uint8Array(bytes));
  });

  it('reports how many writes are waiting, capture or not', async () => {
    await enqueue(entry('plain'));
    await queueCapture(
      {
        id: 'cap_count',
        request: {
          pages: [{ sha256: 's', mimeType: 'image/jpeg', byteSize: 1 }],
          capturedAt: '2026-09-22T04:00:00.000Z',
        },
        pages: [{ mimeType: 'image/jpeg', bytes: new Uint8Array([9]).buffer }],
      },
      'ws-business',
    );
    expect(await pendingWrites()).toBe(2);
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
