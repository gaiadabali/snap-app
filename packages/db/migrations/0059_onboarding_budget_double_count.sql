-- ---------------------------------------------------------------------------
-- 0059 — Remove the "Everything else" budget that onboarding double-counted
--
-- The mobile onboarding sent the SUM of the category budgets the person typed
-- as `monthlyBudget`, and the server stored it as a budget row named
-- 'Everything else' — and then the app wrote the category rows too. The
-- household budget is the sum of all rows (summaries `personalSummary`), so a
-- workspace set to Groceries 600 + Household 150 had budgets of 600 + 150 +
-- 750 = 1500. Fixed in the client (it no longer sends the total); this removes
-- the rows already written.
--
-- WHICH ROWS (all must hold — anything less certain is LEFT ALONE):
--   1. the workspace is personal (only personal onboarding writes the row);
--   2. category = 'Everything else' and monthly > 0;
--   3. the row has not been touched since onboarding: updated_at is within two
--      minutes of the workspace's created_at (the app writes it a moment after
--      creating the workspace, and any later edit bumps updated_at);
--   4. there is at least one other budget row, and monthly equals EXACTLY the
--      sum of the other rows (numeric, no rounding): the signature of a total
--      that was derived from them. A person who typed one number and no
--      categories (the web form) has no other rows and is never touched; one
--      who has since edited a category no longer matches and is never touched.
--
-- Idempotent: a second run finds nothing (the rows are gone). Runs as the
-- migration role, which is not subject to the budgets row-level policy.
--
-- Reverse: not reversible by design (it removes a duplicate). A removed row can
-- be re-created with PUT /v1/budgets {category:'Everything else', monthly}.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';

-- repair:start (packages/db/test/onboarding_budget_double_count.test.ts runs this section)
DELETE FROM budgets e
 USING tenants t
 WHERE t.id = e.tenant_id
   AND t.kind = 'personal'
   AND e.category = 'Everything else'
   AND e.monthly > 0
   AND e.updated_at <= t.created_at + interval '2 minutes'
   AND EXISTS (SELECT 1 FROM budgets o WHERE o.tenant_id = e.tenant_id AND o.category <> 'Everything else')
   AND e.monthly = (SELECT sum(o.monthly) FROM budgets o
                     WHERE o.tenant_id = e.tenant_id AND o.category <> 'Everything else');
-- repair:end
