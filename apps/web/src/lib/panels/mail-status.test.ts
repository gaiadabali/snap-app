import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ api: vi.fn(), linked: undefined as boolean | undefined }));

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('./session', () => ({ requireSession: async () => ({ yourtalLinked: h.linked }) }));
vi.mock('@/lib/api/server', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly body?: unknown,
    ) {
      super(message);
    }
  }
  return { ApiError, api: h.api };
});

import { ApiError } from '@/lib/api/server';
import { getMailGate } from './mail-status';

const status = (over: Record<string, unknown> = {}) => ({
  available: true,
  linked: true,
  mailbox: { state: 'on', address: 'a@b.co' },
  settings: { statements: false, workspaceId: null, alerts: true },
  ...over,
});

beforeEach(() => {
  h.api.mockReset();
  h.linked = true;
});

describe('getMailGate', () => {
  it('is ready for a linked person with mail available', async () => {
    h.api.mockResolvedValue(status());
    expect((await getMailGate()).kind).toBe('ready');
  });

  it('reads linked:false from a 200 status as unlinked (the T11 contract), not an error', async () => {
    h.api.mockResolvedValue(status({ linked: false, mailbox: null }));
    expect((await getMailGate()).kind).toBe('unlinked');
  });

  it('hides mail when the status says it is not available, even for an unlinked person', async () => {
    h.api.mockResolvedValue(status({ available: false, linked: false, mailbox: null }));
    expect((await getMailGate()).kind).toBe('unavailable');
  });

  it('does not call the API when the session already says the person is not linked', async () => {
    h.linked = false;
    expect((await getMailGate()).kind).toBe('unlinked');
    expect(h.api).not.toHaveBeenCalled();
  });

  it('treats 404 (mail_unavailable) as unavailable, and a defensive 409 as unlinked', async () => {
    h.api.mockRejectedValueOnce(new ApiError(404, 'x', { error: 'mail_unavailable' }));
    expect((await getMailGate()).kind).toBe('unavailable');
    h.api.mockRejectedValueOnce(new ApiError(409, 'x', { error: 'yourtal_not_linked' }));
    expect((await getMailGate()).kind).toBe('unlinked');
  });

  it('is an error for anything else', async () => {
    h.api.mockRejectedValueOnce(new ApiError(503, 'x', { error: 'yourtal_unavailable' }));
    expect((await getMailGate()).kind).toBe('error');
    h.api.mockRejectedValueOnce(new Error('network'));
    expect((await getMailGate()).kind).toBe('error');
  });
});
