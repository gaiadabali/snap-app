import { describe, expect, it } from 'vitest';

import { createLlm, LlmError, type LlmEvent, type LlmOptions } from './llm.js';

/**
 * The OpenRouter client, against a fake fetch. No network.
 * Ported from Tunas's chat/test/llm.test.mjs.
 */

const enc = new TextEncoder();
const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
const PARAMS = { max_tokens: 650, temperature: 0.3 };

const chunk = (content: string): string => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const usageChunk = (): string =>
  `data: ${JSON.stringify({ model: 'z-ai/glm-5.3-flash', provider: 'TestProv', choices: [], usage: { prompt_tokens: 11, completion_tokens: 4, cost: 0.0001 } })}\n\n`;

/** A response whose body arrives in pieces of `size` bytes (mid-line, mid-character). */
function sseResponse(text: string, size = 7): Response {
  const bytes = enc.encode(text);
  let pos = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(pos, pos + size));
      pos += size;
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** A response that sends `head` and then stalls until the request is aborted. */
function stallingResponse(head: string, signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head) controller.enqueue(enc.encode(head));
      signal.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
  });
  return new Response(stream, { status: 200 });
}

type Init = { method: string; headers: Record<string, string>; body: string; signal: AbortSignal };
type Call = { url: string; init: Init; body: Record<string, unknown> };

function fakeFetch(script: Array<(init: Init) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = async (url: string, init: Init): Promise<Response> => {
    calls.push({ url, init, body: JSON.parse(init.body) as Record<string, unknown> });
    const h = script[Math.min(calls.length - 1, script.length - 1)];
    if (!h) throw new Error('no script');
    return h(init);
  };
  return { fn, calls };
}

async function collect(gen: AsyncGenerator<LlmEvent, void, void>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const text = (events: LlmEvent[]): string =>
  events.map((e) => (e.type === 'delta' ? e.text : '')).join('');

const mk = (fetch: LlmOptions['fetch'], extra: Partial<LlmOptions> = {}) =>
  createLlm({ apiKey: 'test-key', model: 'm/primary', fetch, retryDelayMs: 5, ...extra });

describe('OpenRouter client', () => {
  it('sends the documented request and yields deltas then usage, across awkward chunk boundaries', async () => {
    const body = `: OPENROUTER PROCESSING\n\n${chunk('Hello ')}${chunk('wörld ')}: keep-alive\n\n${chunk('done.')}${usageChunk()}data: [DONE]\n\n`;
    for (const size of [1, 2, 3, 7, 64, 100_000]) {
      const { fn } = fakeFetch([() => sseResponse(body, size)]);
      const events = await collect(mk(fn).stream({ messages: MESSAGES, params: PARAMS }));
      expect(text(events), `size ${size}`).toBe('Hello wörld done.');
      const last = events.at(-1);
      expect(last?.type).toBe('usage');
      if (last?.type === 'usage') {
        expect(last.usage?.prompt_tokens).toBe(11);
        expect(last.model).toBe('z-ai/glm-5.3-flash');
      }
    }
    const { fn, calls } = fakeFetch([() => sseResponse(body)]);
    await collect(mk(fn).stream({ messages: MESSAGES, params: PARAMS }));
    const call = calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.init.headers.Authorization).toBe('Bearer test-key');
    expect(call?.init.headers['HTTP-Referer']).toBe('https://snap-apps.gaiada.com');
    expect(call?.init.headers['X-Title']).toBe('Snap Apps');
    expect(call?.body).toEqual({
      model: 'm/primary',
      messages: MESSAGES,
      stream: true,
      max_tokens: 650,
      temperature: 0.3,
      top_p: 0.9,
      reasoning: { effort: 'low', exclude: true },
      usage: { include: true },
      provider: { sort: 'latency', data_collection: 'deny', allow_fallbacks: true },
    });
    expect(call?.body).not.toHaveProperty('tools');
  });

  it('never yields reasoning', async () => {
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'secret thoughts', content: '' } }] })}\n\n`;
    const { fn } = fakeFetch([() => sseResponse(`${reasoning}${chunk('Visible')}data: [DONE]\n\n`, 9)]);
    const events = await collect(mk(fn).stream({ messages: MESSAGES, params: PARAMS }));
    expect(text(events)).toBe('Visible');
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('retries once on 503 before the first token, on the fallback model', async () => {
    const { fn, calls } = fakeFetch([() => new Response('busy', { status: 503 }), () => sseResponse(`${chunk('ok')}data: [DONE]\n\n`)]);
    const events = await collect(mk(fn, { fallbackModel: 'm/fallback' }).stream({ messages: MESSAGES, params: PARAMS }));
    expect(text(events)).toBe('ok');
    expect(calls.map((c) => c.body.model)).toEqual(['m/primary', 'm/fallback']);
  });

  it('retries 429 and network errors on the same model when there is no fallback', async () => {
    const a = fakeFetch([() => new Response('slow', { status: 429 }), () => sseResponse(`${chunk('fine')}data: [DONE]\n\n`)]);
    await collect(mk(a.fn).stream({ messages: MESSAGES, params: PARAMS }));
    expect(a.calls.map((c) => c.body.model)).toEqual(['m/primary', 'm/primary']);
    const b = fakeFetch([
      () => {
        throw new TypeError('fetch failed');
      },
      () => sseResponse(`${chunk('fine')}data: [DONE]\n\n`),
    ]);
    expect(text(await collect(mk(b.fn).stream({ messages: MESSAGES, params: PARAMS })))).toBe('fine');
    expect(b.calls).toHaveLength(2);
  });

  it('retries only once, and never a 400', async () => {
    const twice = fakeFetch([() => new Response('x', { status: 502 })]);
    await expect(collect(mk(twice.fn).stream({ messages: MESSAGES, params: PARAMS }))).rejects.toMatchObject({ code: 'upstream_status', status: 502 });
    expect(twice.calls).toHaveLength(2);
    const bad = fakeFetch([() => new Response('bad', { status: 400 })]);
    await expect(collect(mk(bad.fn).stream({ messages: MESSAGES, params: PARAMS }))).rejects.toMatchObject({ code: 'upstream_status', status: 400 });
    expect(bad.calls).toHaveLength(1);
  });

  it('retries a first-token timeout once', async () => {
    const { fn, calls } = fakeFetch([(init) => stallingResponse('', init.signal), () => sseResponse(`${chunk('late but fine')}data: [DONE]\n\n`)]);
    const events = await collect(mk(fn, { timeouts: { firstTokenMs: 40, totalMs: 2000 } }).stream({ messages: MESSAGES, params: PARAMS }));
    expect(text(events)).toBe('late but fine');
    expect(calls).toHaveLength(2);
  });

  it('NEVER retries after the first token: an error mid-stream is thrown, with the text already yielded', async () => {
    const body = `${chunk('Part')}data: ${JSON.stringify({ error: { code: 500, message: 'boom' } })}\n\n`;
    const { fn, calls } = fakeFetch([() => sseResponse(body, 6)]);
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const ev of mk(fn).stream({ messages: MESSAGES, params: PARAMS })) if (ev.type === 'delta') got.push(ev.text);
      })(),
    ).rejects.toSatisfy((e: unknown) => e instanceof LlmError && e.code === 'upstream_error' && /boom/.test(e.message));
    expect(got).toEqual(['Part']);
    expect(calls).toHaveLength(1);
  });

  it('a stall after the first token is not retried: the total timeout throws', async () => {
    const { fn, calls } = fakeFetch([(init) => stallingResponse(chunk('first'), init.signal)]);
    const llm = mk(fn, { timeouts: { firstTokenMs: 1000, totalMs: 60 } });
    await expect(collect(llm.stream({ messages: MESSAGES, params: PARAMS }))).rejects.toMatchObject({ code: 'timeout', phase: 'total' });
    expect(calls).toHaveLength(1);
  });

  it('a caller abort aborts the upstream request', async () => {
    let upstream: AbortSignal | undefined;
    const { fn } = fakeFetch([
      (init) => {
        upstream = init.signal;
        return stallingResponse(chunk('one'), init.signal);
      },
    ]);
    const ctl = new AbortController();
    await expect(
      (async () => {
        for await (const ev of mk(fn).stream({ messages: MESSAGES, params: PARAMS, signal: ctl.signal })) {
          if (ev.type === 'delta') setTimeout(() => ctl.abort(), 5);
        }
      })(),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(upstream?.aborted).toBe(true);
  });

  it('an already-aborted signal never calls fetch; an empty answer is an error', async () => {
    const a = fakeFetch([() => sseResponse('')]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(collect(mk(a.fn).stream({ messages: MESSAGES, params: PARAMS, signal: ctl.signal }))).rejects.toMatchObject({ code: 'aborted' });
    expect(a.calls).toHaveLength(0);
    const b = fakeFetch([() => sseResponse('data: [DONE]\n\n')]);
    await expect(collect(mk(b.fn).stream({ messages: MESSAGES, params: PARAMS }))).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('never puts the key in an error message', async () => {
    const { fn } = fakeFetch([() => new Response('nope', { status: 401 })]);
    const err = await collect(createLlm({ apiKey: 'sk-or-SECRET-123', model: 'm', fetch: fn, retryDelayMs: 1 }).stream({ messages: MESSAGES, params: PARAMS })).catch(
      (e: unknown) => e,
    );
    expect(String((err as Error).message)).not.toContain('SECRET');
    expect(JSON.stringify(err)).not.toContain('SECRET');
  });
});
