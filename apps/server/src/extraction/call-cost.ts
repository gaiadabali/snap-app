/**
 * What one model call cost, in AUD micros (1,000,000 = A$1), the unit of
 * `extraction_runs.cost_micros`.
 *
 * OpenRouter reports the charge in USD on every response (`usage.cost`; the
 * old `usage: { include: true }` request flag is deprecated). It is converted
 * at one rate.
 * ponytail: a fixed rate, 1.4314 as measured 2026-10-20 (group plan Phase 7).
 * Excludes OpenRouter's 5.5% card fee on top-ups. Upgrade to a live rate only
 * if the AUD figure on the admin page starts to matter to the cent; override
 * with `USD_TO_AUD` meanwhile.
 */
export const USD_TO_AUD = Number(process.env.USD_TO_AUD) || 1.4314;

export function usdToAudMicros(usd: unknown): number | null {
  return typeof usd === "number" && Number.isFinite(usd) && usd >= 0
    ? Math.round(usd * USD_TO_AUD * 1_000_000)
    : null;
}

/** One model call that got an answer from the provider, charged or not. */
export type ModelCall = {
  model: string;
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  /** Set when the answer arrived but was unusable (truncated, empty, unparseable). */
  error: string | null;
};

/** Providers that can report what a call cost keep one entry per answered call. */
export interface CallLog {
  readonly modelCalls: ModelCall[];
}
