import { describe, expect, it } from 'vitest';

import { destinationAfterYourtalSignIn } from './yourtal-destination.js';

const ws = [{ id: 'w1', name: 'Mine', kind: 'personal', role: 'owner' }];

describe('destinationAfterYourtalSignIn', () => {
  it('sends an account with no workspace to onboarding, whatever returnTo says', () => {
    expect(destinationAfterYourtalSignIn([], '/app/receipts')).toBe('/onboarding');
    expect(destinationAfterYourtalSignIn([], null)).toBe('/onboarding');
  });

  it('sends an account with a workspace to its stored returnTo', () => {
    expect(destinationAfterYourtalSignIn(ws, '/app/receipts')).toBe('/app/receipts');
  });

  it('falls back to /app when returnTo is missing', () => {
    expect(destinationAfterYourtalSignIn(ws, null)).toBe('/app');
    expect(destinationAfterYourtalSignIn(ws, undefined)).toBe('/app');
  });

  it('refuses an unsafe returnTo even though the server stored it', () => {
    expect(destinationAfterYourtalSignIn(ws, 'https://evil.example.com')).toBe('/app');
    expect(destinationAfterYourtalSignIn(ws, '//evil.example.com')).toBe('/app');
  });
});
