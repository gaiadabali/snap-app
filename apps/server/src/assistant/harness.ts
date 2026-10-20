import type { Facts } from './facts.js';
import { GST_RATE_PERCENT } from './facts.js';
import { createOutputFilter, type OutputFilter, type Source } from './guard-output.js';
import { redactSensitive, screen, trimHistory, type ChatRequest } from './guard-input.js';
import { classify, type Intent } from './intent.js';
import type { ChatMessage, LlmParams } from './llm.js';
import { bareNumbers, findAmounts, findPercents, keyOf, microFromDecimal } from './money.js';
import { canned, systemPrompt, type Actions, type CannedKind } from './prompt.js';
import type { Hit, KbChunk, Retriever } from './retrieve.js';
import { ALLOWED_PATHS, SITE_PAGES } from './site.js';
import { runPreTools } from './tools-bridge.js';

/**
 * The harness: what happens between a visitor's message and the model
 * (docs/ASSISTANT.md §2), ported from Tunas.
 *
 *   plan(req)    screen the message; answer small talk and refusals itself;
 *                otherwise run the pre-tools, retrieve from the knowledge
 *                pack and build the model's messages
 *   filter(plan) the streaming output guard for that plan
 *
 * Nothing here talks to the network: the caller owns the model call, the
 * limits and the stream. Every decision about WHAT may be said lives in these
 * files, testable without a model.
 */

export type Knowledge = { chunks: KbChunk[]; retriever: Retriever; problems: string[] };

export type CannedPlan = {
  kind: 'canned';
  intent: string;
  text: string;
  actions: Actions;
  flags: string[];
  sources: Source[];
};

export type LlmPlan = {
  kind: 'llm';
  intent: Intent;
  messages: ChatMessage[];
  params: LlmParams;
  flags: string[];
  looking?: Source;
  /** Private to the filter. */
  guard: { facts: Facts; allowedMoney: Set<string>; allowedPercents: Set<string>; pagePath: string };
};

export type Plan = CannedPlan | LlmPlan;

export type Harness = {
  plan(req: ChatRequest): Promise<Plan>;
  filter(plan: LlmPlan): OutputFilter;
};

export type HarnessDeps = {
  /** FACTS, cached ≤ 10 minutes. Throws only when there have never been any. */
  getFacts(): Promise<Facts>;
  /** The knowledge pack, with tokens resolved from these facts. */
  getKnowledge(facts: Facts): Knowledge;
};

/** Retrieval: how many sections go to the model, and how much text. */
const K = 6;
const CONTEXT_WORDS = 1300;
/** Sections scoring under this share of the best one are noise. */
const RELATIVE_FLOOR = 0.45;
/**
 * A hit this strong is shown as "Checking: <page>". Tunas measured 8 on its
 * pack; this pack is smaller and its scores lower. NOT calibrated yet: tune
 * it from the eval's `looking` column.
 */
const LOOKING_MIN = 5;

export const PARAMS: LlmParams = Object.freeze({ max_tokens: 650, temperature: 0.3 });

/** Follow-ups that lean on the previous message ("how much is it?", "and on iPhone?"). */
const ANAPHORA = /\b(it|this|that|they|them|those|these|its|one|ones|there|then)\b/i;

/** The page an intent is about, whatever words matched. */
const INTENT_PAGE: Partial<Record<Intent, string>> = {
  human: '/support',
  complaint: '/support',
  account: '/support',
  contact: '/support',
  pricing: '/pricing',
  start: '/pricing',
  app: '/download',
};

const page = (url: string): Source | undefined =>
  ALLOWED_PATHS.has(url) ? { title: SITE_PAGES[url] ?? url, url } : undefined;

export function createHarness(deps: HarnessDeps): Harness {
  function cannedPlan(kind: CannedKind, intent: string, flags: string[]): CannedPlan {
    const c = canned(kind);
    return { kind: 'canned', intent, text: c.text, actions: c.actions, flags, sources: [] };
  }

  function retrieve(retriever: Retriever, userTexts: string[], boostUrl: string | undefined): Hit[] {
    const last = userTexts[userTexts.length - 1] ?? '';
    const prev = userTexts[userTexts.length - 2];
    const words = last.split(/\s+/).filter(Boolean).length;
    const query = prev && (words < 6 || ANAPHORA.test(last)) ? `${prev} ${last}` : last;
    const raw = retriever.search(query, { k: K, boostUrl });
    const max = raw[0]?.score ?? 0;
    const out: Hit[] = [];
    let total = 0;
    for (const h of raw) {
      if (h.score < max * RELATIVE_FLOOR) break;
      const n = h.chunk.text.split(/\s+/).length;
      if (out.length > 0 && total + n > CONTEXT_WORDS) continue;
      total += n;
      out.push(h);
    }
    return out;
  }

  /**
   * The page shown as "Checking: …": the visitor's own page when it scored
   * nearly as well as the best hit, otherwise the best linkable hit.
   */
  function lookingAt(hits: Hit[], here: string | undefined): Source | undefined {
    const top = hits[0];
    if (!top || top.score < LOOKING_MIN) return undefined;
    const near = hits.filter((h) => h.score >= top.score * 0.85 && ALLOWED_PATHS.has(h.chunk.url));
    const pick = near.find((h) => h.chunk.url === here) ?? near[0];
    return pick ? page(pick.chunk.url) : undefined;
  }

  return {
    async plan(req) {
      const last = req.messages[req.messages.length - 1]?.content ?? '';
      const userTexts = req.messages.filter((m) => m.role === 'user').map((m) => m.content);

      // A form-filling bot: a friendly answer, and nothing it can learn from.
      if (req.hp.trim() !== '') return cannedPlan('greeting', 'bot', ['honeypot']);

      const s = screen(last);
      if (s.verdict !== 'ok') return cannedPlan(s.verdict, `blocked:${s.verdict}`, s.flags);

      const intent = classify(last);
      if (intent === 'greeting') return cannedPlan('greeting', 'greeting', s.flags);
      if (intent === 'thanks') return cannedPlan('thanks', 'thanks', s.flags);

      const facts = await deps.getFacts();
      const knowledge = deps.getKnowledge(facts);
      if (knowledge.problems.length) throw new Error(`knowledge pack unusable: ${knowledge.problems[0] ?? ''}`);

      const flags = [...s.flags];
      // Figures from code: the tools run on the redacted message, before the model.
      const tools = runPreTools(redactSensitive(last).text);
      if (tools.verified.length) flags.push(`tools:${tools.verified.map((v) => v.tool).join('+')}`);

      const here = ALLOWED_PATHS.has(req.page.path) ? req.page.path : undefined;
      const hits = retrieve(knowledge.retriever, userTexts, here);
      const forced = INTENT_PAGE[intent];
      const looking = forced ? page(forced) : lookingAt(hits, here && here !== '/' ? here : undefined);

      const history = trimHistory(req.messages);
      if (history.redacted) flags.push('redacted');

      // What the answer may state: FACTS ∪ VERIFIED ∪ the visitor's own figures.
      const allowedMoney = new Set<string>(facts.allowedMoney);
      for (const k of tools.amounts) allowedMoney.add(k);
      const allowedPercents = new Set<string>(tools.percents);
      for (const p of [0, 100, GST_RATE_PERCENT]) {
        const v = microFromDecimal(String(p));
        if (v !== null) allowedPercents.add(keyOf(v));
      }
      for (const m of history.messages) {
        if (m.role !== 'user') continue;
        for (const a of findAmounts(m.content)) allowedMoney.add(keyOf(a.micro));
        for (const n of bareNumbers(m.content)) allowedMoney.add(keyOf(n));
        for (const p of findPercents(m.content)) allowedPercents.add(keyOf(p));
      }
      // Percentages the pack itself states (it can hold no money: see kb.ts).
      for (const h of hits) for (const p of findPercents(h.chunk.text)) allowedPercents.add(keyOf(p));

      const system = systemPrompt({
        facts,
        // The page's title from our own list, never the one the browser sent:
        // that is visitor-controlled text and would land in the system prompt.
        page: { path: req.page.path, title: here ? (SITE_PAGES[here] ?? '') : '' },
        hits,
        verified: tools.verified,
      });

      const plan: LlmPlan = {
        kind: 'llm',
        intent,
        messages: [{ role: 'system', content: system }, ...history.messages],
        params: { ...PARAMS },
        flags,
        guard: { facts, allowedMoney, allowedPercents, pagePath: req.page.path },
      };
      if (looking) plan.looking = looking;
      return plan;
    },

    filter(plan) {
      return createOutputFilter({
        facts: plan.guard.facts,
        intent: plan.intent,
        official: { supportEmail: plan.guard.facts.supportEmail },
        allowedMoney: plan.guard.allowedMoney,
        allowedPercents: plan.guard.allowedPercents,
        looking: plan.looking,
        pagePath: plan.guard.pagePath,
      });
    },
  };
}
