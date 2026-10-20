/**
 * POST /api/assistant and read the Server-Sent Events it answers with
 * (docs/ASSISTANT.md §3), over fetch + ReadableStream so the request can carry
 * a body and be aborted by the stop button.
 */
import type { Cta } from './config';
import type { Source } from './store';

export type ChatEvent =
  | { e: 'meta'; d: { id?: string; intent?: string; looking?: { title: string; url: string } } }
  | { e: 'delta'; d: { t: string } }
  | { e: 'replace'; d: { text: string } }
  | { e: 'actions'; d: { chips?: string[]; cta?: Cta } }
  | { e: 'done'; d: { sources?: Source[]; ms?: number } }
  | { e: 'error'; d: { code: string; text?: string } };

export interface ChatRequest {
  sessionId: string;
  page: { path: string; title: string };
  messages: { role: 'user' | 'assistant'; content: string }[];
  hp?: string;
}

const NAMES = new Set(['meta', 'delta', 'replace', 'actions', 'done', 'error']);
const KNOWN = new Set(['rate_limited', 'busy', 'unavailable', 'bad_request', 'blocked']);

/**
 * Resolves when the stream ends. Rejects with a TypeError on a network failure
 * and with an AbortError when `signal` fires; an HTTP error is delivered as an
 * `error` event, the same shape the server uses mid-stream.
 */
export async function chatStream(req: ChatRequest, signal: AbortSignal, on: (ev: ChatEvent) => void): Promise<void> {
  const res = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(req),
    signal,
    cache: 'no-store',
  });

  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('text/event-stream') || !res.body) {
    // 404 is the API refusing a missing secret: to a visitor that is "not available".
    let code =
      res.status === 429 ? 'rate_limited' : res.status >= 500 || res.status === 404 ? 'unavailable' : 'bad_request';
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === 'string' && KNOWN.has(j.error)) code = j.error;
    } catch {
      /* not JSON */
    }
    on({ e: 'error', d: { code } });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sawEnd = false;

  const dispatch = (block: string): void => {
    let name = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
    }
    if (!data || !NAMES.has(name)) return;
    try {
      const ev = { e: name, d: JSON.parse(data) } as ChatEvent;
      if (name === 'done' || name === 'error') sawEnd = true;
      on(ev);
    } catch {
      /* a malformed event is skipped, never fatal */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      dispatch(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) dispatch(buf);
  // A stream that closed without `done` was cut short: treat it as a network failure.
  if (!sawEnd) throw new TypeError('stream ended early');
}
