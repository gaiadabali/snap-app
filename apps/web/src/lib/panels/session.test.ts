import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

import { toWorkspaceSummaries } from './session';

describe('toWorkspaceSummaries', () => {
  it('keeps teenSpace so the teen nav, notice and redirects can fire (3.10.d D1)', () => {
    const [teen, parent, plain] = toWorkspaceSummaries([
      { id: 't', name: "Teen's space", kind: 'personal', role: 'owner', teenSpace: 'teen' },
      { id: 'p', name: "Teen's space", kind: 'personal', role: 'readonly', teenSpace: 'parent' },
      { id: 'w', name: 'Home', kind: 'personal', role: 'owner' },
    ]);
    expect(teen?.teenSpace).toBe('teen');
    expect(parent?.teenSpace).toBe('parent');
    expect(plain?.teenSpace).toBeNull();
    expect(plain?.baseCurrency).toBe('AUD');
  });
});
