import { config } from '../config.js';
import { readOpenRouterKey } from '../extraction/provider.js';
import { createAssistant, type Assistant } from './assistant.js';
import { assistantConfigFrom, type AssistantConfig } from './config.js';
import { createFactsSource, type Facts } from './facts.js';
import { createHarness, type Knowledge } from './harness.js';
import { buildKb, readKnowledgeFiles, type KbFile } from './kb.js';
import { createLlm } from './llm.js';
import { createLog, type Log } from './log.js';
import { createLimiter } from './ratelimit.js';
import { createRetriever } from './retrieve.js';

/**
 * Production wiring: one assistant per process, built from module-level
 * singletons on first use (the `credits.repo.ts` pattern — no constructor
 * injection anywhere, see assistant.ts).
 *
 * The provider key comes ONLY from `readOpenRouterKey()` — the env var or
 * the OLLAMA_ENV_FILE secret file extraction already uses. It is passed to
 * the LLM client and nowhere else; the startup line says whether one exists,
 * never what it is.
 */

let instance: Assistant | null = null;

/** Builds the knowledge pack for a set of facts, memoised on the resolved tokens. */
export function knowledgeLoader(files: KbFile[], log: Pick<Log, 'error' | 'info'>): (facts: Facts) => Knowledge {
  let lastKey = '';
  let last: Knowledge | null = null;
  return (facts) => {
    const tokens = {
      FREE_SCANS: String(facts.freeScans),
      PRICE_PER_SCAN: facts.perScanText,
      PACK_SIZES: facts.packSizesText,
    };
    const key = JSON.stringify(tokens);
    if (last && key === lastKey) return last;
    const kb = buildKb(files, tokens);
    if (kb.problems.length) {
      // Fail loudly, once per change: status turns ok:false and chat answers "unavailable".
      log.error('knowledge pack failed', { problems: kb.problems.slice(0, 5), count: kb.problems.length });
    } else {
      log.info('knowledge pack loaded', { files: files.length, chunks: kb.chunks.length, dropped: kb.dropped, warnings: kb.warnings.length });
    }
    last = { chunks: kb.chunks, retriever: createRetriever(kb.chunks), problems: kb.problems };
    lastKey = key;
    return last;
  };
}

function hasKey(): string {
  try {
    return readOpenRouterKey();
  } catch {
    return '';
  }
}

export function buildAssistant(cfg: AssistantConfig): Assistant {
  const log = createLog({ logTranscripts: cfg.logTranscripts });
  const apiKey = hasKey();
  const files = readKnowledgeFiles();
  const facts = createFactsSource({
    onError: (e) => log.error('facts load failed', { err: String((e as Error)?.message ?? e).slice(0, 300) }),
  });
  const getKnowledge = knowledgeLoader(files, log);
  const harness = createHarness({ getFacts: () => facts.get(), getKnowledge });
  const llm = apiKey ? createLlm({ apiKey, model: cfg.model, fallbackModel: cfg.fallbackModel }) : null;
  const limiter = createLimiter({ dailyLimit: cfg.dailyLimit });

  log.info('assistant ready', {
    model: cfg.model,
    fallbackModel: cfg.fallbackModel || null,
    key: Boolean(apiKey),
    proxySecret: Boolean(cfg.proxySecret),
    knowledgeFiles: files.length,
    dailyLimit: cfg.dailyLimit,
    transcripts: cfg.logTranscripts,
  });
  if (!apiKey) log.error('no OpenRouter key: set OPENROUTER_API_KEY or an OPENROUTER_API_KEY= line in OLLAMA_ENV_FILE');
  if (cfg.production && !cfg.proxySecret) log.error('ASSISTANT_PROXY_SECRET is not set: the assistant is disabled in production');

  return createAssistant({
    config: cfg,
    harness,
    llm,
    limiter,
    log,
    async ready() {
      if (!apiKey) return false;
      if (cfg.production && !cfg.proxySecret) return false;
      const f = await facts.get();
      return getKnowledge(f).problems.length === 0;
    },
  });
}

/** The process's assistant, built on first use from the validated configuration. */
export function getAssistant(): Assistant {
  instance ??= buildAssistant(assistantConfigFrom(config()));
  return instance;
}
