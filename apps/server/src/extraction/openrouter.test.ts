import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MODELS, openRouterModelId } from '../ai/router.js';
import { OPENROUTER_BASE_URL, OpenRouterProvider, readOpenRouterKey } from './provider.js';
import { OpenRouterStatementProvider } from './statement-provider.js';

const EXTRACTION_JSON = JSON.stringify({
  docType: { value: 'tax_invoice', confidence: 0.9 },
  payableAmount: { value: '29.00', confidence: 0.9 },
  lines: [],
  notes: { legible: true },
});

function stubFetch(content: string) {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('openRouterModelId', () => {
  it('has an OpenRouter id for every registry model', () => {
    for (const m of MODELS) expect(m.openrouterId).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
  });

  it('translates a registry id', () => {
    expect(openRouterModelId('gemma4:31b')).toBe('google/gemma-4-31b-it');
  });

  it('refuses an id it does not know rather than passing it through', () => {
    expect(() => openRouterModelId('gpt-4o')).toThrow(/Unknown model/);
  });
});

describe('readOpenRouterKey', () => {
  it('reads the named line, not the first *KEY* line in a shared file', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const dir = mkdtempSync(join(tmpdir(), 'or-key-'));
    const file = join(dir, 'ollama.env');
    writeFileSync(file, 'OLLAMA_CLOUD_API_KEY=ollama-secret\nOPENROUTER_API_KEY="sk-or-test"\n');
    vi.stubEnv('OLLAMA_ENV_FILE', file);
    expect(readOpenRouterKey()).toBe('sk-or-test');
  });

  it('refuses when there is no OpenRouter key, and does not fall back to the Ollama one', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const dir = mkdtempSync(join(tmpdir(), 'or-key-'));
    const file = join(dir, 'ollama.env');
    writeFileSync(file, 'OLLAMA_CLOUD_API_KEY=ollama-secret\n');
    vi.stubEnv('OLLAMA_ENV_FILE', file);
    expect(() => readOpenRouterKey()).toThrow(/No OpenRouter key/);
  });
});

describe('OpenRouterProvider', () => {
  it('posts to OpenRouter with the OpenRouter model id and key', async () => {
    const fetchMock = stubFetch(EXTRACTION_JSON);
    const provider = new OpenRouterProvider('google/gemma-4-31b-it', undefined, 'sk-or-test');

    const result = await provider.extract({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    expect(JSON.parse(init.body as string).model).toBe('google/gemma-4-31b-it');
    expect(result.meta.provider).toBe('openrouter');
    expect(result.meta.model).toBe('google/gemma-4-31b-it');
  });

  it('names itself in an upstream error, without the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', { status: 401 })));
    const provider = new OpenRouterProvider('google/gemma-4-31b-it', undefined, 'sk-or-test');
    const err = await provider.extract({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }).catch((e: Error) => e);
    expect(String(err)).toMatch(/openrouter google\/gemma-4-31b-it returned 401/);
    expect(String(err)).not.toContain('sk-or-test');
  });
});

describe('OpenRouterStatementProvider', () => {
  it('posts statement text to OpenRouter', async () => {
    const fetchMock = stubFetch(JSON.stringify({ lines: [], notes: { legible: true } }));
    const provider = new OpenRouterStatementProvider('z-ai/glm-5.3', 'sk-or-test');

    await provider.extractChunk(['01/08 COFFEE 4.50'], { from: 1, to: 1 }, 1, 'day_first', 'AUD');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(JSON.parse(init.body as string).model).toBe('z-ai/glm-5.3');
    expect(provider.name).toBe('openrouter');
  });
});

/** A fetch that only the abort signal ends, like a provider that hangs. */
function stubHangingFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    ),
  );
}

describe('per-call timeout (group 1.29)', () => {
  it('fails a hung receipt call with a message naming the model and the limit', async () => {
    stubHangingFetch();
    const provider = new OpenRouterProvider('google/gemma-4-31b-it', undefined, 'sk-or-test', 50);
    const started = Date.now();
    const err = await provider.extract({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }).catch((e: Error) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(String(err)).toMatch(/google\/gemma-4-31b-it timed out after 0 s/);
  });

  it('passes an abort signal to fetch on both receipt and statement calls', async () => {
    const fetchMock = stubFetch(EXTRACTION_JSON);
    await new OpenRouterProvider('m', undefined, 'k').extract({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);

    const stmt = stubFetch(JSON.stringify({ lines: [], notes: { legible: true } }));
    await new OpenRouterStatementProvider('m', 'k').extractChunk(['x'], { from: 1, to: 1 }, 1, 'day_first', 'AUD');
    expect((stmt.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('cuts a hung statement chunk call too', async () => {
    stubHangingFetch();
    const provider = new OpenRouterStatementProvider('z-ai/glm-5.3', 'k', 50);
    const err = await provider
      .extractChunk(['x'], { from: 1, to: 1 }, 1, 'day_first', 'AUD')
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/z-ai\/glm-5.3 timed out after/);
  });

  it('does not mistake an ordinary upstream error for a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    const provider = new OpenRouterProvider('m', undefined, 'k', 5_000);
    const err = await provider.extract({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }).catch((e: Error) => e);
    expect(String(err)).toMatch(/returned 500/);
    expect(String(err)).not.toMatch(/timed out/);
  });
});
