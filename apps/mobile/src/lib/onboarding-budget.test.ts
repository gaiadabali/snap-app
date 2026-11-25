import { describe, expect, it } from 'vitest';

import { onboardingBudgets } from './onboarding-budget';

describe('onboardingBudgets', () => {
  it('writes one row per category and never a total, so the sum is not doubled', () => {
    const out = onboardingBudgets([
      { name: ' Groceries ', amount: '600' },
      { name: 'Household', amount: '150.5' },
    ]);
    expect(out.monthlyBudget).toBeNull();
    expect(out.categories).toEqual([
      { name: 'Groceries', monthly: '600.0000' },
      { name: 'Household', monthly: '150.5000' },
    ]);
    const total = out.categories.reduce((a, c) => a + Number(c.monthly), 0);
    expect(total).toBe(750.5);
  });

  it('drops unnamed, zero and non-numeric drafts', () => {
    expect(
      onboardingBudgets([
        { name: '', amount: '10' },
        { name: 'Fuel', amount: '0' },
        { name: 'Fun', amount: 'abc' },
      ]).categories,
    ).toEqual([]);
  });
});
