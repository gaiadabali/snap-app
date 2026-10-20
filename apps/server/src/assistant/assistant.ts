import { randomBytes } from 'node:crypto';

import { proxyGate, type AssistantConfig } from './config.js';
import { validateChatRequest, type ChatRequest } from './guard-input.js';
import type { Harness, Plan } from './harness.js';
import type { Llm, LlmUsage } from './llm.js';
import type { Log } from './log.js';
import { errorText } from './prompt.js';
import type { Limiter } from './ratelimit.js';
import { openSse, sendJson, type RawResponse } from './sse.js';

/**
 * The assistant's two routes as plain functions (docs/ASSISTANT.md §3) —
 * Tunas's `createApp(deps)` shape. `assistant.controller.ts` is a thin Nest
 * shell that hands these the raw request pieces and Fastify's raw response;
 * tests drive them with fakes and an in-memory response.
 *
 * No Nest, no decorators, no injection here: the server runs under tsx,
 * which drops decorator metadata, so anything relying on it works in vitest
 * and is undefined in production.
 */

export const CHAT_BODY_MAX = 16 * 1024;
export const PING_MS = 15_000;
export const ASSISTANT_NAME = 'Snapper';

export type IncomingRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** The TCP peer, as Fastify reports it. */
  socketIp: string;
};

export type AssistantDeps = {
  config: AssistantConfig;
  harness: Harness;
  /** null when no OpenRouter key is configured: canned answers still work, model answers fail closed. */
  llm: Llm | null;
  limiter: Limiter;
  log: Log;
  /** Whether the key, the knowledge pack and the facts are all usable right now. */
  ready(): Promise<boolean>;
  now?: () => number;
  pingMs?: number;
  /** Delay between canned-answer deltas. */
  chunkDelayMs?: number;
};

export type Assistant = {
  status(req: IncomingRequest, res: RawResponse): Promise<void>;
  chat(req: IncomingRequest, res: RawResponse): Promise<void>;
};

function header(h: IncomingRequest['headers'], name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Split text into ~3-word pieces, keeping every character. */
export function chunkWords(text: string, perChunk = 3): string[] {
  const words = text.match(/\s*\S+\s*/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += perChunk) out.push(words.slice(i, i + perChunk).join(''));
  const used = out.join('');
  if (used.length < text.length) out.push(text.slice(used.length));
  return out;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const IP_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;

/** The request body's size in bytes: the declared length, or the parsed body re-measured. */
function bodyBytes(req: IncomingRequest): number {
  const declared = Number(header(req.headers, 'content-length'));
  if (Number.isFinite(declared) && declared >= 0) return declared;
  try {
    return Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createAssistant(deps: AssistantDeps): Assistant {
  const { config, harness, llm, limiter, log } = deps;
  const now = deps.now ?? Date.now;
  const pingMs = deps.pingMs ?? PING_MS;
  const chunkDelayMs = deps.chunkDelayMs ?? 16;

  async function status(req: IncomingRequest, res: RawResponse): Promise<void> {
    const gate = proxyGate(header(req.headers, 'x-assistant-proxy'), config);
    if (config.proxySecret && !gate.allowed) return sendJson(res, 404, { error: 'not_found' });
    // Production without a secret: the assistant is off, and says so (fail closed).
    if (!gate.allowed) return sendJson(res, 200, { ok: false, name: ASSISTANT_NAME });
    let ok = false;
    try {
      ok = await deps.ready();
    } catch (e) {
      log.error('status check failed', { err: String((e as Error)?.message ?? e) });
    }
    sendJson(res, 200, { ok, name: ASSISTANT_NAME });
  }

  async function chat(req: IncomingRequest, res: RawResponse): Promise<void> {
    const gate = proxyGate(header(req.headers, 'x-assistant-proxy'), config);
    if (!gate.allowed) return sendJson(res, 404, { error: 'not_found' });
    if (bodyBytes(req) > CHAT_BODY_MAX) return sendJson(res, 413, { error: 'too_large' }, { Connection: 'close' });

    const v = validateChatRequest(req.body);
    if (!v.ok) return sendJson(res, 400, { error: 'bad_request' });
    const value: ChatRequest = v.value;

    // The forwarded client IP is believed only alongside a matching secret.
    const forwarded = header(req.headers, 'x-assistant-client-ip')?.trim();
    const ip = gate.trusted && forwarded && IP_SHAPE.test(forwarded) ? forwarded : req.socketIp || 'unknown';

    const started = now();
    const id = randomBytes(5).toString('hex');
    const hit = limiter.hitChat(ip, value.sessionId);
    const sse = openSse(res);

    if (!hit.ok) {
      sse.send('meta', { id, intent: hit.code });
      sse.send('error', { code: hit.code, text: errorText(hit.code) });
      sse.close();
      log.answer({ id, ip, sessionId: value.sessionId, intent: hit.code, flags: [], kind: 'limited', firstMs: null, totalMs: now() - started, code: hit.code });
      return;
    }

    // From here on: stream the answer. `clientGone` is set when the visitor disconnects early.
    const upstream = new AbortController();
    let clientGone = false;
    let finished = false;
    const onClose = (): void => {
      if (!finished && !res.writableFinished) {
        clientGone = true;
        upstream.abort();
      }
    };
    res.on('close', onClose);
    const ping = setInterval(() => sse.comment('ping'), pingMs);
    ping.unref?.();

    let flags: string[] = [];
    let intent = 'unknown';
    let kind = 'unknown';
    let firstMs: number | null = null;
    let usage: LlmUsage | null = null;
    let usedModel = '';
    let code = '';
    let reply = '';

    try {
      let plan: Plan;
      try {
        plan = await harness.plan(value);
      } catch (e) {
        log.error('plan failed', { id, err: String((e as Error)?.message ?? e) });
        code = 'unavailable';
        sse.send('meta', { id, intent: 'error' });
        sse.send('error', { code, text: errorText(code) });
        return;
      }
      intent = plan.intent;
      kind = plan.kind;
      flags = [...plan.flags];
      if (clientGone) return;
      sse.send('meta', { id, intent: plan.intent, ...(plan.kind === 'llm' && plan.looking ? { looking: plan.looking } : {}) });

      if (plan.kind === 'canned') {
        for (const piece of chunkWords(plan.text)) {
          if (clientGone) return;
          sse.send('delta', { t: piece });
          firstMs ??= now() - started;
          await sleep(chunkDelayMs, upstream.signal);
        }
        reply = plan.text;
        if (clientGone) return;
        sse.send('actions', plan.actions);
        sse.send('done', { sources: plan.sources, ms: now() - started });
        return;
      }

      // ---- model answer ----
      if (!llm) {
        code = 'unavailable';
        log.error('no model key configured', { id });
        sse.send('error', { code, text: errorText(code) });
        return;
      }
      const f = harness.filter(plan);
      let pushed = false;
      let failure: unknown = null;
      try {
        for await (const ev of llm.stream({ messages: plan.messages, params: plan.params, signal: upstream.signal })) {
          if (clientGone) break;
          if (ev.type === 'usage') {
            usage = ev.usage;
            usedModel = ev.model || usedModel;
            continue;
          }
          pushed = true;
          firstMs ??= now() - started;
          const r = f.push(ev.text);
          if (r.text) {
            sse.send('delta', { t: r.text });
            reply += r.text;
          }
          if (r.stop) {
            upstream.abort(); // stop paying for tokens that will not be shown
            break;
          }
        }
      } catch (e) {
        failure = e;
      }
      if (clientGone) {
        code = 'aborted';
        return;
      }

      if (failure) {
        code = 'unavailable';
        const err = failure as { message?: unknown; code?: unknown; status?: unknown };
        log.error('upstream failed', { id, err: String(err?.message ?? failure).slice(0, 300), ucode: err?.code, status: err?.status });
        if (pushed) {
          // Let the filter flush or withdraw what it was holding before saying sorry.
          const e = f.end();
          flags = [...flags, ...e.flags];
          if (e.tail) {
            sse.send('delta', { t: e.tail });
            reply += e.tail;
          }
          if (e.replace) {
            sse.send('replace', { text: e.replace });
            reply = e.replace;
          }
        }
        sse.send('error', { code, text: errorText(code) });
        return;
      }

      const e = f.end();
      flags = [...flags, ...e.flags];
      if (e.tail) {
        sse.send('delta', { t: e.tail });
        reply += e.tail;
      }
      if (e.replace) {
        sse.send('replace', { text: e.replace });
        reply = e.replace;
      }
      sse.send('actions', e.actions);
      sse.send('done', { sources: e.sources, ms: now() - started });
    } catch (err) {
      code = 'unavailable';
      log.error('answer failed', { id, err: String((err as Error)?.message ?? err) });
      sse.send('error', { code, text: errorText(code) });
    } finally {
      finished = true;
      if (clientGone && !code) code = 'aborted';
      clearInterval(ping);
      if (!upstream.signal.aborted) upstream.abort();
      sse.close();
      res.off('close', onClose);
      const lastUser = [...value.messages].reverse().find((m) => m.role === 'user');
      log.answer({
        id,
        ip,
        sessionId: value.sessionId,
        intent,
        flags,
        kind,
        firstMs,
        totalMs: now() - started,
        tokensIn: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
        tokensOut: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined,
        cost: typeof usage?.cost === 'number' ? usage.cost : undefined,
        model: usedModel || undefined,
        code: code || undefined,
        page: value.page.path,
        user: lastUser?.content ?? '',
        reply,
      });
    }
  }

  return {
    async status(req, res) {
      try {
        await status(req, res);
      } catch (err) {
        log.error('status failed', { err: String((err as Error)?.message ?? err) });
        if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
        else if (!res.writableEnded) res.end();
      }
    },
    async chat(req, res) {
      try {
        await chat(req, res);
      } catch (err) {
        log.error('chat failed', { err: String((err as Error)?.message ?? err) });
        if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
        else if (!res.writableEnded) res.end();
      }
    },
  };
}
