/**
 * Server-sent events writer (docs/ASSISTANT.md §3). One JSON object per event
 * on a single line; writes after close are ignored, because the visitor may
 * leave at any moment.
 *
 * Works on the raw Node response (Fastify's `reply.raw`), never on Nest's
 * reply abstraction: a stream has to be flushed as it is written.
 */

/** The part of `http.ServerResponse` this file and the assistant use. */
export type RawResponse = {
  writeHead(status: number, headers: Record<string, string | number>): unknown;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
  on(event: 'close', fn: () => void): unknown;
  off(event: 'close', fn: () => void): unknown;
  flushHeaders?(): void;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished?: boolean;
  readonly destroyed: boolean;
};

export type Sse = {
  send(event: string, data: unknown): boolean;
  comment(text?: string): boolean;
  close(): void;
  readonly closed: boolean;
};

export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
  Connection: 'keep-alive',
  'X-Content-Type-Options': 'nosniff',
});

/** Write the SSE response head (flushed immediately) and return the writer. */
export function openSse(res: RawResponse): Sse {
  let closed = false;
  const onClose = (): void => {
    closed = true;
  };
  res.on('close', onClose);
  res.writeHead(200, { ...SSE_HEADERS });
  res.flushHeaders?.();

  const write = (chunk: string): boolean => {
    if (closed || res.writableEnded || res.destroyed) return false;
    try {
      res.write(chunk);
      return true;
    } catch {
      closed = true;
      return false;
    }
  };

  return {
    send(event, data) {
      // JSON.stringify never emits a raw newline, so `data:` is exactly one line.
      return write(`event: ${event.replace(/[\r\n]+/g, '')}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text = 'ping') {
      return write(`: ${String(text).replace(/[\r\n]+/g, ' ')}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.off('close', onClose);
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* already gone */
      }
    },
    get closed() {
      return closed || res.writableEnded || res.destroyed;
    },
  };
}

/** A JSON answer on the raw response (errors before any stream, status). */
export function sendJson(
  res: RawResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  if (res.headersSent || res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(text);
}
