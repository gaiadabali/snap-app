/**
 * What onboarding sends for the budgets the person typed in step 3.
 *
 * The household's budget is the SUM of its budget rows (the server's
 * `/v1/summaries/personal` adds them up; there is no separate total). So the
 * only correct write is one row per category, and NOTHING for a total:
 * `monthlyBudget` on `completeOnboarding` makes the server store a further
 * "Everything else" row, which is how $600 + $150 once showed as $1,500 left to
 * spend. `monthlyBudget` stays for a client that has one number and no
 * categories (the web sign-up form).
 */
export type DraftBudget = { name: string; amount: string };

export function onboardingBudgets(drafts: DraftBudget[]): {
  monthlyBudget: null;
  categories: Array<{ name: string; monthly: string }>;
} {
  return {
    monthlyBudget: null,
    categories: drafts
      .filter((d) => d.name.trim() && Number(d.amount) > 0)
      .map((d) => ({ name: d.name.trim(), monthly: Number(d.amount).toFixed(4) })),
  };
}
