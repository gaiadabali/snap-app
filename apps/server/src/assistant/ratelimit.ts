/**
 * In-memory sliding-window limiter for the assistant (docs/ASSISTANT.md §8),
 * ported from Tunas.
 *
 * Per IP 6/min, 40/hour, 150/day; per session 60 in total; a global budget per
 * UTC day → 'busy'. A refused hit is never recorded, so a blocked visitor
 * recovers as soon as the window slides.
 *
 * In memory, unlike the Postgres-backed `auth/rate-limit.ts`, deliberately:
 * this protects a model budget, not an account. Two replicas would each allow
 * the limits (an over-spend bounded by the replica count; today there is one
 * api container), and the chat stays free of a database round trip on every
 * message.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type ChatHit =
  | { ok: true }
  | { ok: false; code: 'rate_limited' | 'busy'; retryAfterMs: number };

export type Limiter = {
  hitChat(ip: string, sessionId: string): ChatHit;
  sweep(): void;
  size(): { ips: number; sessions: number };
  stop(): void;
};

export type LimiterOptions = {
  now?: () => number;
  dailyLimit?: number;
  maxKeys?: number;
  /** 0 disables the timer. */
  sweepMs?: number;
  sessionLimit?: number;
};

const IP_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [6, MIN],
  [40, HOUR],
  [150, DAY],
];

export function createLimiter({
  now = Date.now,
  dailyLimit = 3000,
  maxKeys = 50_000,
  sweepMs = 10 * MIN,
  sessionLimit = 60,
}: LimiterOptions = {}): Limiter {
  const ips = new Map<string, number[]>();
  const sessions = new Map<string, { count: number; last: number }>();
  let globalDay = '';
  let globalCount = 0;

  /** Drop timestamps older than `span`, in place. */
  function prune(arr: number[], t: number, span: number): void {
    let i = 0;
    while (i < arr.length && (arr[i] ?? 0) <= t - span) i++;
    if (i) arr.splice(0, i);
  }

  /** ms until one more hit is allowed by a (limit, span) window; 0 when allowed now. */
  function waitFor(arr: number[], t: number, limit: number, span: number): number {
    const inWin = arr.filter((x) => x > t - span);
    if (inWin.length < limit) return 0;
    return (inWin[inWin.length - limit] ?? t) + span - t;
  }

  /** Bounded map: touching moves a key to the newest slot, overflow evicts the oldest. */
  function touch<V>(map: Map<string, V>, key: string, make: () => V): V {
    let v = map.get(key);
    if (v === undefined) v = make();
    else map.delete(key);
    map.set(key, v);
    while (map.size > maxKeys) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    return v;
  }

  const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
  const nextUtcMidnight = (t: number): number => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };

  function sweep(): void {
    const t = now();
    for (const [k, arr] of ips) {
      prune(arr, t, DAY);
      if (!arr.length) ips.delete(k);
    }
    for (const [k, s] of sessions) if (t - s.last > DAY) sessions.delete(k);
  }

  const timer = sweepMs > 0 ? setInterval(sweep, sweepMs) : null;
  timer?.unref();

  return {
    hitChat(ip, sessionId) {
      const t = now();
      const day = utcDay(t);
      if (day !== globalDay) {
        globalDay = day;
        globalCount = 0;
      }

      const ipArr = ips.get(ip) ?? [];
      prune(ipArr, t, DAY);
      let wait = 0;
      for (const [limit, span] of IP_WINDOWS) wait = Math.max(wait, waitFor(ipArr, t, limit, span));
      if (wait > 0) return { ok: false, code: 'rate_limited', retryAfterMs: wait };

      const sess = sessions.get(sessionId);
      if (sess && sess.count >= sessionLimit) return { ok: false, code: 'rate_limited', retryAfterMs: DAY };

      if (globalCount >= dailyLimit) {
        return { ok: false, code: 'busy', retryAfterMs: nextUtcMidnight(t) - t };
      }

      ipArr.push(t);
      touch(ips, ip, () => ipArr);
      const s = touch(sessions, sessionId, () => ({ count: 0, last: t }));
      s.count++;
      s.last = t;
      globalCount++;
      return { ok: true };
    },
    sweep,
    size: () => ({ ips: ips.size, sessions: sessions.size }),
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
