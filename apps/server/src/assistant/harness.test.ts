import { describe, expect, it } from 'vitest';

import { createFactsSource } from './facts.js';
import type { ChatRequest } from './guard-input.js';
import { createHarness, type LlmPlan } from './harness.js';
import { readKnowledgeFiles } from './kb.js';
import { createRetriever } from './retrieve.js';
import { PACK_ROWS } from './test-support.js';
import { knowledgeLoader } from './wiring.js';

const quiet = { error: () => undefined, info: () => undefined };
const files = readKnowledgeFiles(new URL('./test-fixtures/knowledge/', import.meta.url));

function harness() {
  const facts = createFactsSource({ loadPacks: async () => PACK_ROWS });
  return createHarness({ getFacts: () => facts.get(), getKnowledge: knowledgeLoader(files, quiet) });
}

const req = (messages: ChatRequest['messages'], path = '/'): ChatRequest => ({
  sessionId: '3f2b8c1e-9a4d-4c2b-8e1f-0a1b2c3d4e5f',
  page: { path, title: '' },
  messages,
  hp: '',
});

describe('harness plan', () => {
  it('joins a short follow-up to the previous question for retrieval', async () => {
    const plan = (await harness().plan(
      req([
        { role: 'user', content: 'how do I install the app on Android?' },
        { role: 'assistant', content: 'Download the APK from the download page.' },
        { role: 'user', content: 'and on iPhone?' },
      ]),
    )) as LlmPlan;
    expect(plan.kind).toBe('llm');
    expect(plan.intent).toBe('app');
    expect(plan.looking).toEqual({ title: 'Download', url: '/download' });
    // retrieved from the pack (CONTEXT), not just the FACTS line
    expect(plan.messages[0]?.content.split('# CONTEXT')[1]).toContain('The iPhone app is in development');
    expect(plan.messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('sends the model redacted history and records it', async () => {
    const plan = (await harness().plan(req([{ role: 'user', content: 'my TFN is 123 456 789, how long do I keep receipts?' }]))) as LlmPlan;
    expect(plan.messages.at(-1)?.content).not.toContain('123 456 789');
    expect(plan.flags).toContain('redacted');
    expect(plan.flags).toContain('tools:retention_period');
  });

  it('refuses to answer from a broken pack', async () => {
    const facts = createFactsSource({ loadPacks: async () => PACK_ROWS });
    const h = createHarness({
      getFacts: () => facts.get(),
      getKnowledge: () => ({ chunks: [], retriever: createRetriever([]), problems: ['the knowledge pack is empty'] }),
    });
    await expect(h.plan(req([{ role: 'user', content: 'does it work offline?' }]))).rejects.toThrow(/knowledge pack/);
    // small talk still works without the pack
    expect((await h.plan(req([{ role: 'user', content: 'hello' }]))).kind).toBe('canned');
  });
});
