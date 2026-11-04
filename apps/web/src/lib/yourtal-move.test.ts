import { describe, expect, it } from 'vitest';

import { showYourtalMove } from './yourtal-move';

const base = { yourtalLinked: false, teenSpace: null, impersonating: false, available: true, dismissed: false } as const;

describe('showYourtalMove', () => {
  it('shows for an unlinked account', () => expect(showYourtalMove(base)).toBe(true));
  it('shows in a parent space', () => expect(showYourtalMove({ ...base, teenSpace: 'parent' })).toBe(true));
  it('is hidden in a teen space', () => expect(showYourtalMove({ ...base, teenSpace: 'teen' })).toBe(false));
  it('is hidden once linked, and when the server did not say', () => {
    expect(showYourtalMove({ ...base, yourtalLinked: true })).toBe(false);
    expect(showYourtalMove({ ...base, yourtalLinked: undefined })).toBe(false);
  });
  it('is hidden while impersonating, when YourTal sign-in is off, and once dismissed', () => {
    expect(showYourtalMove({ ...base, impersonating: true })).toBe(false);
    expect(showYourtalMove({ ...base, available: false })).toBe(false);
    expect(showYourtalMove({ ...base, dismissed: true })).toBe(false);
  });
});
