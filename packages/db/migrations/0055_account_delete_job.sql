-- ---------------------------------------------------------------------------
-- 0051 — The API may queue an `account_delete` job
--
-- Group task 8.3.a (yourtal/docs/29 §6: "8.3.a's in-app delete calls
-- erase_person"). Someone deleting their own SnapApp account from the phone
-- calls `POST /v1/auth/account/delete` (the API, app_rw). erase_person is the
-- worker's only (0043), so the API stores a `jobs` row and the worker runs it.
--
-- Same shape as 0044: INSERT only, tenant_id NULL (the job erases workspaces
-- and must not live inside one), kind `account_delete`. No SELECT, UPDATE or
-- DELETE, and no other kind. The payload ({"userId"}) is written by the API
-- after it has checked the caller's own session, password (when the account
-- has one) and typed confirmation; it is no stronger than that. A forged row
-- would need the API's database login, which can already read and change every
-- workspace's data through its own policies.
-- ---------------------------------------------------------------------------

CREATE POLICY jobs_account_delete_insert ON jobs
  FOR INSERT
  TO app_rw
  WITH CHECK (tenant_id IS NULL AND kind = 'account_delete');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'jobs' AND policyname = 'jobs_account_delete_insert'
                    AND cmd = 'INSERT' AND roles = '{app_rw}') THEN
    RAISE EXCEPTION 'jobs_account_delete_insert must be INSERT-only, for app_rw';
  END IF;
END $$;
