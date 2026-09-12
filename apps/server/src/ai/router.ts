/**
 * Which model runs which task.
 *
 * Two decisions live here, and both were made from measurements rather than
 * reputation (see `docs/AI.md` for the scores):
 *
 *  1. **Specialisation.** Vision and chat are different capabilities and the
 *     available models are not interchangeable — GLM and DeepSeek answered a
 *     tax question competently and returned HTTP 400 for an image. So a task
 *     names a capability, and only models with that capability are eligible.
 *
 *  2. **Escalation, not retry.** A failed extraction is re-run on a STRONGER
 *     model, not the same one again. Re-asking a model that produced
 *     unparseable output at temperature 0 produces the same output; the only
 *     thing that changes the answer is changing the reader.
 *
 * Every model here is cheap and none is trusted. The validators decide whether
 * an extraction is acceptable, which is what makes a budget model safe.
 */

export type Capability = 'vision' | 'chat';

export type ModelSpec = {
  id: string;
  capabilities: Capability[];
  /** Where it sits in the escalation order. 1 is tried first. */
  tier: 1 | 2 | 3;
  /**
   * Out of 8 on the RETIRED single-image docket benchmark. null if untested.
   *
   * Kept for the history, not for decisions: five of the six vision-capable
   * models scored 8/8 on it, so it cannot rank anything. `bench/compare.py`
   * now scores per field across a corpus; when that produces a comparable
   * aggregate, this becomes it.
   */
  benchmarkScore: number | null;
  /**
   * Median seconds per extraction call.
   *
   * Measured 2026-09-11: 5 repeats across the 4-document corpus, n=20 pooled
   * per model (`bench/results/20260911T080356Z`). The previous values were a
   * SINGLE sample each, from one image, and were labelled medians — which is
   * why re-measuring them was worth 80 calls.
   *
   * The corpus includes the two-page invoice, which sends two images and runs
   * 3-4x slower for every model. That is deliberate: multi-page is a shipped
   * capability, so the number the router sorts on should reflect the requests
   * it actually serves, not only the easy half of them.
   *
   * The two chat-only models below are NOT part of that measurement — the
   * corpus is a vision corpus, and they cannot read an image. Their numbers
   * are still single samples from `bench/chat.py` and should be read as such.
   */
  medianSeconds: number | null;
  /** Why this model is in the list, in one line. */
  note: string;
  /**
   * Capabilities this model is BARRED from, each with the reason.
   *
   * Distinct from simply omitting the capability: the model genuinely has the
   * ability, and we refuse to use it anyway. Keeping it in the registry with
   * the reason attached means the measurement that justified the exclusion
   * survives, and the next person to look does not "fix" it by adding the
   * capability back.
   *
   * `chain()` filters on this, so an excluded model can never be selected or
   * escalated to for that capability.
   */
  excludedFrom?: Partial<Record<Capability, string>>;
};

/**
 * The registry.
 *
 * Ordered by tier so escalation is a walk down the list. Scores are from the
 * committed benchmark and are meant to be re-run when a model is added — a
 * registry of untested models is a registry of guesses.
 */
export const MODELS: ModelSpec[] = [
  {
    id: 'minimax-m3',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 5.39,
    note: 'Primary reader. Perfect on a creased, glare-covered thermal docket.',
  },
  {
    id: 'gemma4:31b',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 2.82,
    note: 'Fastest and cheapest at 140 output tokens. Non-Chinese fallback.',
  },
  {
    id: 'kimi-k3',
    capabilities: ['vision', 'chat'],
    tier: 2,
    benchmarkScore: 8,
    medianSeconds: 7.28,
    note: 'Escalation. Same accuracy, slower, different failure modes.',
  },
  {
    id: 'qwen3.5:397b',
    capabilities: ['vision', 'chat'],
    tier: 3,
    benchmarkScore: 8,
    medianSeconds: 23.21,
    note: 'Last resort. Accurate but spends thousands of tokens reasoning.',
  },
  {
    id: 'glm-5.3',
    capabilities: ['chat'],
    tier: 1,
    benchmarkScore: null,
    medianSeconds: 3.4,
    note: 'Chat only — returns 400 for an image. Fast and fluent.',
  },
  {
    id: 'deepseek-v4-flash:0731',
    capabilities: ['chat'],
    tier: 2,
    benchmarkScore: null,
    medianSeconds: 4.4,
    note: 'Chat only. Cheap, and excluded — see excludedFrom.',
    excludedFrom: {
      chat:
        'docs/AI.md §2.3: it called the tools and then failed to report what ' +
        'they returned. A model that ignores the authoritative answer it just ' +
        'requested is worse than one with no tools, because the wrong figure ' +
        'now appears sanctioned. Scored 2/4 with tools where every other ' +
        'candidate scored 4/4.',
    },
  },
];

export class NoModelAvailableError extends Error {
  constructor(capability: Capability, tier: number) {
    super(`No ${capability} model at tier ${tier} or below.`);
    this.name = 'NoModelAvailableError';
  }
}

/**
 * The models to try, in order, for a capability.
 *
 * `preferred` pins a specific model — used by the benchmark and by a replay,
 * where the point is to reproduce a particular run rather than to get the best
 * answer available today.
 */
export function chain(capability: Capability, preferred?: string): ModelSpec[] {
  if (preferred) {
    const pinned = MODELS.find((m) => m.id === preferred);
    if (!pinned) throw new Error(`Unknown model: ${preferred}`);
    const barred = pinned.excludedFrom?.[capability];
    if (barred) {
      // Refused even when explicitly pinned. A replay or a benchmark may want
      // to reproduce a particular run, but not one this project has decided
      // is unsafe to serve — that decision should not be reachable by
      // passing a string.
      throw new Error(`${preferred} is excluded from ${capability}. ${barred}`);
    }
    if (!pinned.capabilities.includes(capability)) {
      // Caught here rather than as a 400 from the provider three seconds
      // later, with a message that says which models would have worked.
      const usable = MODELS.filter((m) => m.capabilities.includes(capability)).map((m) => m.id);
      throw new Error(
        `${preferred} cannot do ${capability}. Models that can: ${usable.join(', ')}.`,
      );
    }
    return [pinned];
  }

  const eligible = MODELS.filter(
    (m) => m.capabilities.includes(capability) && !m.excludedFrom?.[capability],
  ).sort(
    (a, b) => a.tier - b.tier || (a.medianSeconds ?? 99) - (b.medianSeconds ?? 99),
  );
  if (eligible.length === 0) throw new NoModelAvailableError(capability, 3);
  return eligible;
}

/** The single best model for a capability, ignoring escalation. */
export function primary(capability: Capability): ModelSpec {
  return chain(capability)[0]!;
}
