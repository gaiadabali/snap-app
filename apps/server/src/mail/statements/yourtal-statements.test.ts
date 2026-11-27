import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ bytes: vi.fn(), call: vi.fn() }));
vi.mock('../../yourtal/oidc-client-api.js', () => ({ oidcApiBytes: api.bytes, oidcApiCall: api.call }));

const { ackStatement, fetchOfferedFile } = await import('./yourtal-statements.js');

const json = (status: number, body: object) => ({ status, bytes: Buffer.from(JSON.stringify(body)), contentType: 'application/json' });

beforeEach(() => {
  api.bytes.mockReset();
  api.call.mockReset();
});

describe('fetchOfferedFile (BUILD.md §5.2 /attachments/fetch)', () => {
  it('asks for exactly the offered pair, size-capped, and returns the bytes', async () => {
    api.bytes.mockResolvedValue({ status: 200, bytes: Buffer.from('%PDF-'), contentType: 'application/pdf' });
    expect(await fetchOfferedFile('s', 'M1', 'B1')).toEqual({ state: 'ok', bytes: Buffer.from('%PDF-'), contentType: 'application/pdf' });
    expect(api.bytes).toHaveBeenCalledWith(
      'spambank',
      'POST',
      '/api/oidc-clients/spambank/attachments/fetch',
      { sub: 's', emailId: 'M1', blobId: 'B1' },
      { maxBytes: 10 * 1024 * 1024 + 64 * 1024 },
    );
  });

  it.each([
    [json(404, { code: 'not_found' }), { state: 'not_offered' }],
    [json(404, { code: 'unknown_subject' }), { state: 'not_allowed' }],
    [json(403, { code: 'not_allowed' }), { state: 'not_allowed' }],
    [json(409, { code: 'not_enabled' }), { state: 'not_allowed' }],
    [json(400, { code: 'invalid_request' }), { state: 'rejected', status: 400 }],
    [json(503, { code: 'spambank_unavailable' }), { state: 'unavailable', status: 503 }],
    [json(429, { code: 'rate_limited' }), { state: 'unavailable', status: 429 }],
    [null, { state: 'unavailable', status: null }],
  ])('answer %j is %j', async (answer, expected) => {
    api.bytes.mockResolvedValue(answer);
    expect(await fetchOfferedFile('s', 'M1', 'B1')).toEqual(expected);
  });
});

describe('ackStatement (BUILD.md §5.2 /statements/ack)', () => {
  it('sends the outcome and a detail of at most 500 characters', async () => {
    api.call.mockResolvedValue({ status: 204, body: {} });
    expect(await ackStatement('s', 'M1', 'B1', 'skipped', 'x'.repeat(600))).toBe('done');
    expect(api.call).toHaveBeenCalledWith('spambank', 'POST', '/api/oidc-clients/spambank/statements/ack', {
      sub: 's',
      emailId: 'M1',
      blobId: 'B1',
      outcome: 'skipped',
      detail: 'x'.repeat(500),
    });
  });

  it('leaves out an empty detail', async () => {
    api.call.mockResolvedValue({ status: 204, body: {} });
    await ackStatement('s', 'M1', 'B1', 'imported', null);
    expect(api.call.mock.calls[0]?.[3]).not.toHaveProperty('detail');
  });

  it.each([
    [{ status: 404, body: { code: 'not_found' } }, 'done'],
    [{ status: 403, body: {} }, 'done'],
    [{ status: 400, body: {} }, 'done'],
    [{ status: 429, body: {} }, 'retry'],
    [{ status: 502, body: {} }, 'retry'],
    [null, 'retry'],
  ])('answer %j is %s', async (answer, expected) => {
    api.call.mockResolvedValue(answer);
    expect(await ackStatement('s', 'M1', 'B1', 'imported', null)).toBe(expected);
  });
});
