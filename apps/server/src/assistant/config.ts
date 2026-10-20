import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Snapper's runtime settings (docs/ASSISTANT.md §4, §8).
 *
 * The values arrive through `config.ts` (the one place `process.env` is
 * read); this file turns them into what the assistant uses, tolerating the
 * empty strings compose passes for an unset `${VAR:-}` so a blank variable
 * can never stop the API from booting. Every field is optional on purpose:
 * the assistant is a feature of the API, not a reason for it to refuse to
 * start. A missing key or secret turns the assistant off (status ok:false),
 * nothing more.
 */

export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
export const DEFAULT_DAILY_LIMIT = 3000;

export type AssistantConfig = {
  model: string;
  /** Used only for the single retry before the first token. '' = retry on `model`. */
  fallbackModel: string;
  /** Global answers per UTC day before the assistant says it is busy. */
  dailyLimit: number;
  /** The shared secret the web proxy sends as X-Assistant-Proxy. '' = unset. */
  proxySecret: string;
  /** ASSISTANT_LOG_TRANSCRIPTS=1: the question and answer text go into the log line. */
  logTranscripts: boolean;
  production: boolean;
};

export type AssistantEnv = {
  ASSISTANT_MODEL?: string | undefined;
  ASSISTANT_FALLBACK_MODEL?: string | undefined;
  ASSISTANT_DAILY_LIMIT?: string | undefined;
  ASSISTANT_PROXY_SECRET?: string | undefined;
  ASSISTANT_LOG_TRANSCRIPTS?: string | undefined;
  NODE_ENV?: string | undefined;
};

function positiveInt(v: string | undefined, fallback: number): number {
  const s = (v ?? '').trim();
  if (!/^\d+$/.test(s)) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function assistantConfigFrom(env: AssistantEnv): AssistantConfig {
  return {
    model: env.ASSISTANT_MODEL?.trim() || DEFAULT_MODEL,
    fallbackModel: env.ASSISTANT_FALLBACK_MODEL?.trim() || '',
    dailyLimit: positiveInt(env.ASSISTANT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    proxySecret: env.ASSISTANT_PROXY_SECRET?.trim() || '',
    logTranscripts: env.ASSISTANT_LOG_TRANSCRIPTS?.trim() === '1',
    production: env.NODE_ENV === 'production',
  };
}

/**
 * Whether a request may use the assistant, from its X-Assistant-Proxy header.
 *
 *  - secret set: the header must match it (constant time; hashing first makes
 *    the comparison length-independent, so the length of the secret leaks no
 *    more than its value does);
 *  - secret unset in production: never — the assistant is off (fail closed);
 *  - secret unset elsewhere: allowed, so local development works without one.
 *
 * `trusted` says whether the proxy's forwarded headers (the client IP) may be
 * believed: only alongside a secret that actually matched.
 */
export function proxyGate(
  header: string | string[] | undefined,
  cfg: Pick<AssistantConfig, 'proxySecret' | 'production'>,
): { allowed: boolean; trusted: boolean } {
  if (!cfg.proxySecret) return { allowed: !cfg.production, trusted: false };
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value === '') return { allowed: false, trusted: false };
  const a = createHash('sha256').update(value, 'utf8').digest();
  const b = createHash('sha256').update(cfg.proxySecret, 'utf8').digest();
  const ok = timingSafeEqual(a, b);
  return { allowed: ok, trusted: ok };
}
