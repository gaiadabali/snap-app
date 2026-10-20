/**
 * OpenRouter streaming client (docs/ASSISTANT.md §4), ported from Tunas's
 * llm.mjs — same body, timeouts, retry rule and routing.
 *
 * stream() yields { type: 'delta', text } for every piece of answer text and
 * finally { type: 'usage', usage, model, provider }. Only delta.content is
 * ever yielded, never reasoning. Before the first token ONE retry is made
 * (429 / 5xx / network error / first-token timeout / upstream error object)
 * after retryDelayMs, using fallbackModel when set. After the first token
 * nothing is retried: the error is thrown.
 *
 * The key is held in a closure and only ever written into the Authorization
 * header. No error message here includes it, or any header.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type LlmErrorCode = 'upstream_status' | 'timeout' | 'aborted' | 'upstream_error';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number | undefined;
  /** Which timer fired, for code === 'timeout'. */
  readonly phase: 'first' | 'total' | undefined;

  constructor(code: LlmErrorCode, message: string, extra: { status?: number; phase?: 'first' | 'total'; cause?: unknown } = {}) {
    super(message, extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = 'LlmError';
    this.code = code;
    this.status = extra.status;
    this.phase = extra.phase;
  }
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmParams = { max_tokens: number; temperature: number };
export type LlmUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number } & Record<string, unknown>;
export type LlmEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: LlmUsage | null; model: string; provider: string };

export type Llm = {
  stream(args: { messages: ChatMessage[]; params: LlmParams; signal?: AbortSignal }): AsyncGenerator<LlmEvent, void, void>;
};

/** The part of a web-stream reader used here (kept structural: no DOM lib in this tsconfig). */
type StreamReader = { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>; cancel(): Promise<void> };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

export type LlmOptions = {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  fetch?: FetchLike;
  timeouts?: { firstTokenMs: number; totalMs: number };
  retryDelayMs?: number;
  url?: string;
  /** OpenRouter provider routing. */
  routing?: Record<string, unknown>;
};

export const DEFAULT_ROUTING = Object.freeze({ sort: 'latency', data_collection: 'deny', allow_fallbacks: true });

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new LlmError('aborted', 'aborted during retry delay'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new LlmError('aborted', 'aborted during retry delay'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createLlm({
  apiKey,
  model,
  fallbackModel = '',
  fetch: fetchImpl = globalThis.fetch as unknown as FetchLike,
  timeouts = { firstTokenMs: 7000, totalMs: 25000 },
  retryDelayMs = 400,
  url = OPENROUTER_URL,
  routing = { ...DEFAULT_ROUTING },
}: LlmOptions): Llm {
  function retryable(err: LlmError): boolean {
    if (err.code === 'upstream_status') return err.status === 429 || (err.status ?? 0) >= 500;
    if (err.code === 'timeout') return err.phase === 'first';
    return err.code === 'upstream_error';
  }

  return {
    async *stream({ messages, params, signal }) {
      if (signal?.aborted) throw new LlmError('aborted', 'aborted before start');

      // The total deadline spans both attempts.
      const total = new AbortController();
      let totalFired = false;
      const totalTimer = setTimeout(() => {
        totalFired = true;
        total.abort();
      }, timeouts.totalMs);
      const onCallerAbort = (): void => total.abort();
      signal?.addEventListener('abort', onCallerAbort, { once: true });

      /** One upstream call. */
      async function* runAttempt(useModel: string): AsyncGenerator<LlmEvent, void, void> {
        const attemptCtl = new AbortController();
        let firstFired = false;
        const link = (): void => attemptCtl.abort();
        total.signal.addEventListener('abort', link, { once: true });
        if (total.signal.aborted) attemptCtl.abort();
        const firstTimer = setTimeout(() => {
          firstFired = true;
          attemptCtl.abort();
        }, timeouts.firstTokenMs);

        // Rejects when the attempt is aborted, so a pending read can never hang.
        const aborted = new Promise<never>((_, reject) => {
          const fire = (): void => reject(new Error('attempt aborted'));
          if (attemptCtl.signal.aborted) fire();
          else attemptCtl.signal.addEventListener('abort', fire, { once: true });
        });
        aborted.catch(() => undefined);

        const classify = (e: unknown): LlmError => {
          if (e instanceof LlmError) return e;
          if (signal?.aborted) return new LlmError('aborted', 'aborted by caller', { cause: e });
          if (totalFired) return new LlmError('timeout', 'total timeout', { phase: 'total', cause: e });
          if (firstFired) return new LlmError('timeout', 'first token timeout', { phase: 'first', cause: e });
          return new LlmError('upstream_error', e instanceof Error ? e.message : String(e), { cause: e });
        };

        let reader: StreamReader | undefined;
        try {
          let res: Response;
          try {
            res = await Promise.race([
              fetchImpl(url, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  Accept: 'text/event-stream',
                  'HTTP-Referer': 'https://snap-apps.gaiada.com',
                  'X-Title': 'Snap Apps',
                },
                body: JSON.stringify({
                  model: useModel,
                  messages,
                  stream: true,
                  max_tokens: params.max_tokens,
                  temperature: params.temperature,
                  top_p: 0.9,
                  reasoning: { effort: 'low', exclude: true },
                  usage: { include: true },
                  // Fastest provider first, and only providers that do not keep
                  // prompts: visitors type their own details into this chat.
                  provider: routing,
                }),
                signal: attemptCtl.signal,
              }),
              aborted,
            ]);
          } catch (e) {
            throw classify(e);
          }
          if (!res.ok) {
            try {
              await res.body?.cancel();
            } catch {
              /* ignore */
            }
            throw new LlmError('upstream_status', `upstream status ${res.status}`, { status: res.status });
          }
          if (!res.body) throw new LlmError('upstream_error', 'empty body');

          reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let gotToken = false;
          let finished = false;
          let usage: LlmUsage | null = null;
          let usedModel = useModel;
          let provider = '';

          /** The text to yield for one SSE line, or null. Throws on an upstream error object. */
          const handleLine = (line: string): string | null => {
            if (!line || line.startsWith(':')) return null; // blank or comment (": OPENROUTER PROCESSING")
            if (!line.startsWith('data:')) return null;
            const payload = line.slice(5).trim();
            if (!payload) return null;
            if (payload === '[DONE]') {
              finished = true;
              return null;
            }
            let json: Record<string, unknown>;
            try {
              json = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              return null; // not JSON: ignore rather than fail the whole answer
            }
            if (json && json.error) {
              const err = json.error as { message?: unknown; code?: unknown } | string;
              const msg = typeof err === 'string' ? err : String(err.message ?? 'upstream error');
              const code = typeof err === 'object' && typeof err.code === 'number' ? err.code : undefined;
              throw new LlmError('upstream_error', msg.slice(0, 300), code !== undefined ? { status: code } : {});
            }
            if (json.usage && typeof json.usage === 'object') usage = json.usage as LlmUsage;
            if (typeof json.model === 'string') usedModel = json.model;
            if (typeof json.provider === 'string') provider = json.provider;
            const choices = json.choices as Array<{ delta?: { content?: unknown } }> | undefined;
            const content = choices?.[0]?.delta?.content;
            return typeof content === 'string' && content.length ? content : null;
          };

          while (!finished) {
            let chunk: { done: boolean; value?: Uint8Array | undefined };
            try {
              chunk = await Promise.race([reader.read(), aborted]);
            } catch (e) {
              throw classify(e);
            }
            if (chunk.done) {
              buffer += decoder.decode();
              break;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            let nl: number;
            while (!finished && (nl = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, nl).replace(/\r$/, '');
              buffer = buffer.slice(nl + 1);
              const text = handleLine(line);
              if (text !== null) {
                if (!gotToken) {
                  gotToken = true;
                  clearTimeout(firstTimer);
                }
                yield { type: 'delta', text };
              }
            }
          }
          if (!finished && buffer.trim()) {
            const text = handleLine(buffer.replace(/\r$/, ''));
            if (text !== null) {
              gotToken = true;
              yield { type: 'delta', text };
            }
          }
          if (!gotToken) throw new LlmError('upstream_error', 'upstream returned no text');
          yield { type: 'usage', usage, model: usedModel, provider };
        } finally {
          clearTimeout(firstTimer);
          total.signal.removeEventListener('abort', link);
          attemptCtl.abort();
          try {
            await reader?.cancel();
          } catch {
            /* ignore */
          }
        }
      }

      let yielded = false;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const useModel = attempt === 0 ? model : fallbackModel || model;
          try {
            for await (const ev of runAttempt(useModel)) {
              if (ev.type === 'delta') yielded = true;
              yield ev;
            }
            return;
          } catch (e) {
            const err = e instanceof LlmError ? e : new LlmError('upstream_error', String(e), { cause: e });
            if (yielded || attempt === 1 || !retryable(err) || signal?.aborted || total.signal.aborted) throw err;
            try {
              await sleep(retryDelayMs, total.signal);
            } catch {
              throw totalFired
                ? new LlmError('timeout', 'total timeout', { phase: 'total' })
                : new LlmError('aborted', 'aborted by caller');
            }
          }
        }
      } finally {
        clearTimeout(totalTimer);
        signal?.removeEventListener('abort', onCallerAbort);
        total.abort(); // no attempt is left running if the consumer stopped early
      }
    },
  };
}
