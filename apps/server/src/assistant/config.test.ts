import { describe, expect, it } from 'vitest';

import { assistantConfigFrom, DEFAULT_MODEL, proxyGate } from './config.js';
import { createLog, redact } from './log.js';

describe('assistant settings', () => {
  it('defaults everything, and treats the empty strings compose passes as unset', () => {
    const c = assistantConfigFrom({
      ASSISTANT_MODEL: '',
      ASSISTANT_FALLBACK_MODEL: '',
      ASSISTANT_DAILY_LIMIT: '',
      ASSISTANT_PROXY_SECRET: '  ',
      ASSISTANT_LOG_TRANSCRIPTS: '',
      NODE_ENV: 'production',
    });
    expect(c).toEqual({ model: DEFAULT_MODEL, fallbackModel: '', dailyLimit: 3000, proxySecret: '', logTranscripts: false, production: true });
    expect(DEFAULT_MODEL).toBe('z-ai/glm-5.3-flash');
  });

  it('reads the values when set, and ignores a nonsense limit', () => {
    const c = assistantConfigFrom({ ASSISTANT_MODEL: 'x/y', ASSISTANT_DAILY_LIMIT: '50', ASSISTANT_LOG_TRANSCRIPTS: '1', NODE_ENV: 'development' });
    expect(c).toMatchObject({ model: 'x/y', dailyLimit: 50, logTranscripts: true, production: false });
    expect(assistantConfigFrom({ ASSISTANT_DAILY_LIMIT: '-5' }).dailyLimit).toBe(3000);
    expect(assistantConfigFrom({ ASSISTANT_DAILY_LIMIT: '1e9' }).dailyLimit).toBe(3000);
  });
});

describe('the proxy gate', () => {
  const prod = { proxySecret: 's3cret', production: true };
  it('allows and trusts only the exact secret', () => {
    expect(proxyGate('s3cret', prod)).toEqual({ allowed: true, trusted: true });
    expect(proxyGate(['s3cret'], prod)).toEqual({ allowed: true, trusted: true });
    for (const h of [undefined, '', 's3cre', 's3cret ', 'S3CRET', 's3crets']) expect(proxyGate(h, prod)).toEqual({ allowed: false, trusted: false });
  });

  it('fails closed in production without a secret; allows, untrusted, in development', () => {
    expect(proxyGate('anything', { proxySecret: '', production: true })).toEqual({ allowed: false, trusted: false });
    expect(proxyGate(undefined, { proxySecret: '', production: false })).toEqual({ allowed: true, trusted: false });
  });

  it('still requires the secret in development once it is set', () => {
    expect(proxyGate(undefined, { proxySecret: 'dev', production: false }).allowed).toBe(false);
  });
});

describe('the log line', () => {
  it('hashes the IP and session, and writes no message text by default', () => {
    const lines: string[] = [];
    const log = createLog({ write: (l) => void lines.push(l), salt: 'x' });
    log.answer({ id: 'a1', ip: '203.0.113.9', sessionId: 'sess', intent: 'question', user: 'my secret question', reply: 'an answer' });
    const rec = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(rec).toMatchObject({ ev: 'answer', id: 'a1', intent: 'question' });
    expect(rec.ipH).toMatch(/^[0-9a-f]{12}$/);
    expect(lines[0]).not.toContain('203.0.113.9');
    expect(lines[0]).not.toContain('sess"');
    expect(lines[0]).not.toContain('secret question');
    expect(lines[0]).not.toContain('an answer');
  });

  it('writes redacted text only when transcripts are on', () => {
    const lines: string[] = [];
    const log = createLog({ write: (l) => void lines.push(l), logTranscripts: true });
    log.answer({ id: 'a2', user: 'email me at jo@example.com, TFN 123 456 789', reply: 'ok' });
    expect(lines[0]).toContain('[email]');
    expect(lines[0]).toContain('[number]');
    expect(lines[0]).not.toContain('jo@example.com');
    expect(redact('call 0412 345 678')).toBe('call [number]');
  });
});
