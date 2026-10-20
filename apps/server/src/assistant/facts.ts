import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { formatAud, formatCents, keyOf, microFromDecimal } from './money.js';
import { SITE_URL } from './site.js';

/**
 * `# FACTS` (docs/ASSISTANT.md §5.2): what Snapper may state as fact, from the
 * same sources the product itself uses — never typed into the knowledge pack.
 *
 *  - Free scans at signup: FREE_SCANS_AT_SIGNUP, which `facts.test.ts` pins to
 *    the literal `credits.repo.ts#grantSignupBonusIfFirst` actually grants, so
 *    the chat cannot drift from the grant.
 *  - Credit packs: the ACTIVE rows of `credit_packs`, read directly. The table
 *    is a public price list (`credit_packs_read ... USING (true)`, `GRANT
 *    SELECT ... TO app_rw`, migration 0024), so no tenant context is needed —
 *    the visitor is anonymous. Cached for at most ten minutes.
 *  - The per-scan price is derived in integer micro-dollars (price ÷ credits),
 *    never in floating point.
 */

export const FREE_SCANS_AT_SIGNUP = 10;
export const SUPPORT_EMAIL = 'support@snapapps.com.au';
/** The GST rate the tools state (gst_on_sale: "10% ADDED"). */
export const GST_RATE_PERCENT = 10;

export type PackRow = { code: string; credits: number; price_aud: string };
export type PackFact = { code: string; credits: number; priceMicro: bigint; priceText: string; perScanMicro: bigint };

export type Facts = {
  siteUrl: string;
  supportEmail: string;
  freeScans: number;
  packs: PackFact[];
  /** The cheapest per-scan price across active packs, micro-dollars; null when there are no packs. */
  perScanMicro: bigint | null;
  /** True when every active pack has the same per-scan price. */
  perScanUniform: boolean;
  /** "3.7 cents" (or "from 3.7 cents" when packs differ); '' without packs. */
  perScanText: string;
  /** "50, 100, 200, 500 and 1,000 scans"; '' without packs. */
  packSizesText: string;
  /** Money the answer may state: every pack price and per-scan price, in micro-dollar keys. */
  allowedMoney: Set<string>;
};

/** price ÷ credits in micro-dollars, rounded half up, integer arithmetic only. */
export function perScan(priceMicro: bigint, credits: number): bigint {
  const c = BigInt(credits);
  return (priceMicro * 2n + c) / (2n * c);
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

export function factsFromPacks(rows: PackRow[]): Facts {
  const packs: PackFact[] = [];
  for (const r of rows) {
    const priceMicro = microFromDecimal(String(r.price_aud));
    const credits = Number(r.credits);
    if (priceMicro === null || !Number.isSafeInteger(credits) || credits <= 0) continue;
    packs.push({
      code: r.code,
      credits,
      priceMicro,
      priceText: formatAud(priceMicro),
      perScanMicro: perScan(priceMicro, credits),
    });
  }
  const rates = packs.map((p) => p.perScanMicro);
  const min = rates.length ? rates.reduce((a, b) => (b < a ? b : a)) : null;
  const uniform = rates.every((r) => r === rates[0]);
  const show = (m: bigint): string => (m < 1_000_000n ? formatCents(m) : formatAud(m));
  const allowedMoney = new Set<string>(['0']);
  for (const p of packs) {
    allowedMoney.add(keyOf(p.priceMicro));
    allowedMoney.add(keyOf(p.perScanMicro));
  }
  return {
    siteUrl: SITE_URL,
    supportEmail: SUPPORT_EMAIL,
    freeScans: FREE_SCANS_AT_SIGNUP,
    packs,
    perScanMicro: min,
    perScanUniform: uniform,
    perScanText: min === null ? '' : `${uniform ? '' : 'from '}${show(min)}`,
    packSizesText: packs.length ? `${joinAnd(packs.map((p) => p.credits.toLocaleString('en-AU')))} scans` : '',
    allowedMoney,
  };
}

/** The active packs, in display order. Public price list: no tenant context needed. */
export async function loadActivePacks(): Promise<PackRow[]> {
  const res = await getDb().execute<PackRow>(sql`
    select code, credits, price_aud::text as price_aud
      from credit_packs
     where active = true
     order by sort_order
  `);
  return res.rows;
}

export type FactsSource = {
  /** Fresh facts (≤ ttl old), the last good ones if a reload fails, or a throw when there never were any. */
  get(): Promise<Facts>;
  /** What is cached right now, without loading. */
  peek(): Facts | null;
};

export function createFactsSource({
  loadPacks = loadActivePacks,
  now = Date.now,
  ttlMs = 10 * 60_000,
  retryMs = 30_000,
  onError,
}: {
  loadPacks?: () => Promise<PackRow[]>;
  now?: () => number;
  ttlMs?: number;
  /** After a failed load, how long the stale copy is served before trying again. */
  retryMs?: number;
  onError?: (err: unknown) => void;
} = {}): FactsSource {
  let cached: Facts | null = null;
  let freshUntil = 0;
  let inflight: Promise<Facts> | null = null;

  async function load(): Promise<Facts> {
    try {
      const facts = factsFromPacks(await loadPacks());
      cached = facts;
      freshUntil = now() + ttlMs;
      return facts;
    } catch (err) {
      onError?.(err);
      if (cached) {
        freshUntil = now() + retryMs;
        return cached;
      }
      throw err;
    }
  }

  return {
    get() {
      if (cached && now() < freshUntil) return Promise.resolve(cached);
      inflight ??= load().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    peek: () => cached,
  };
}
