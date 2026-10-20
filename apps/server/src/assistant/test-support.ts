import { EventEmitter } from 'node:events';

import type { RawResponse } from './sse.js';

/**
 * Test helpers for the assistant's suites (no network, no database). Lives
 * beside the code rather than in `src/test-support/` because only these
 * suites use it.
 */

export type FakeResponse = RawResponse & {
  readonly status: number | null;
  readonly head: Record<string, string | number> | null;
  readonly chunks: string[];
  readonly flushed: boolean;
  /** Simulate the visitor going away. */
  disconnect(): void;
  /** Everything written, joined. */
  readonly body: string;
};

export function fakeResponse(): FakeResponse {
  const ee = new EventEmitter();
  const state = {
    status: null as number | null,
    head: null as Record<string, string | number> | null,
    chunks: [] as string[],
    flushed: false,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
  };
  const res: FakeResponse = {
    get status(): number | null {
      return state.status;
    },
    get head(): Record<string, string | number> | null {
      return state.head;
    },
    get chunks(): string[] {
      return state.chunks;
    },
    get flushed(): boolean {
      return state.flushed;
    },
    get headersSent(): boolean {
      return state.headersSent;
    },
    get writableEnded(): boolean {
      return state.writableEnded;
    },
    get writableFinished(): boolean {
      return state.writableEnded;
    },
    get destroyed(): boolean {
      return state.destroyed;
    },
    get body(): string {
      return state.chunks.join('');
    },
    writeHead(status: number, headers: Record<string, string | number>): void {
      state.status = status;
      state.head = headers;
      state.headersSent = true;
    },
    flushHeaders(): void {
      state.flushed = true;
    },
    write(chunk: string): boolean {
      state.chunks.push(chunk);
      return true;
    },
    end(chunk?: string): void {
      if (chunk) state.chunks.push(chunk);
      state.writableEnded = true;
      ee.emit('close');
    },
    on(event: 'close', fn: () => void): void {
      ee.on(event, fn);
    },
    off(event: 'close', fn: () => void): void {
      ee.off(event, fn);
    },
    disconnect(): void {
      state.destroyed = true;
      ee.emit('close');
    },
  };
  return res;
}

export type SseFrame = { event: string; data: Record<string, unknown> };

/** Parse an SSE body into its events (comments dropped). */
export function parseSse(body: string): SseFrame[] {
  const out: SseFrame[] = [];
  for (const frame of body.split('\n\n')) {
    if (!frame.trim() || frame.startsWith(':')) continue;
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event || data === undefined) continue;
    out.push({ event, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

/** The active packs of migration 0029, as `credit_packs` returns them. */
export const PACK_ROWS = [
  { code: 'credits_50', credits: 50, price_aud: '1.8500' },
  { code: 'credits_100', credits: 100, price_aud: '3.7000' },
  { code: 'credits_200', credits: 200, price_aud: '7.4000' },
  { code: 'credits_500', credits: 500, price_aud: '18.5000' },
  { code: 'credits_1000', credits: 1000, price_aud: '37.0000' },
];
