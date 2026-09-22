-- ---------------------------------------------------------------------------
-- 0035 — rate_limits: one counter per key, shared by every API process
--
-- Production-readiness remediation Task 17.
--
-- WHY THIS TABLE EXISTS. Rate limiting was in-memory (a Map in
-- `apps/server/src/auth/rate-limit.ts`). Two API replicas — or one container
-- restart — each counted separately, so the real limit was N x instances and
-- a restart handed an attacker a fresh allowance. This table is the shared
-- store: the counter lives in Postgres, the thing every replica already
-- talks to, rather than adding Redis for one integer.
--
-- SHAPE. One row per bucket key (`email:x`, `ip:1.2.3.4`, `global:…`), holding
-- the CURRENT fixed window: `window_start` is the floor of now/window and
-- `count` the attempts inside it. A fixed window needs exactly one row per
-- key — no history, no cleanup job, no unbounded growth — and the consume is
-- a single atomic upsert, so two processes racing on the same key cannot
-- both read "3 of 5" and both admit themselves. That race was the bug.
--
-- NOT TENANT-SCOPED, deliberately: a rate limit is keyed on the caller (an
-- IP or an unverified email) which exists before authentication and belongs
-- to no tenant. It follows the `mail_deliveries` pattern from 0034 — RLS on
-- and forced, a permissive policy for `app_rw` — but unlike that table the
-- contents are not sensitive (an IP and a count, no addresses-of-record and
-- no bodies), so app_rw gets a full permissive policy rather than a
-- write-only one.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limits (
  /* The limit key, namespaced by its caller: `email:a@b.c`, `ip:10.0.0.1`,
     `global:10.0.0.1`. A text key rather than separate columns, so a new
     limiter (per-key, per-tenant, global) is a key prefix, not a migration. */
  bucket_key   text NOT NULL,
  /* Floor(now / window). The primary key is bucket_key ALONE — one row per
     key, reused window after window — which is what keeps this table at the
     size of the live traffic rather than the size of all history. */
  window_start timestamptz NOT NULL,
  /* Attempts inside this window. `>= 1` because a row only exists when
     something was consumed; the CASE in the consumer's upsert keeps it true. */
  count        int NOT NULL DEFAULT 1 CHECK (count >= 1),

  PRIMARY KEY (bucket_key)
);

-- ── RLS, following 0034's pattern (enabled AND forced) ───────────────────

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE  ROW LEVEL SECURITY;

-- The API (snap_app, via app_rw) reads and writes its own counters; there is
-- no tenant boundary to enforce and no privilege to withhold: every limit
-- needs read-modify-write, and the values are IPs and counts.
CREATE POLICY rate_limits_app ON rate_limits
  FOR ALL
  TO app_rw
  USING (true)
  WITH CHECK (true);

-- REVOKE FIRST, same reason as 0034: this database carries a DEFAULT ACL
-- (`app_rw=arwd/postgres`), so the grant below grants nothing new by itself —
-- but neither does doing nothing, and the explicit pair makes the intent true
-- at both layers.
REVOKE ALL ON rate_limits FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO app_rw;

-- The worker has no business with request counters, and neither does the
-- reporting role.
REVOKE ALL ON rate_limits FROM app_worker;
REVOKE ALL ON rate_limits FROM app_readonly;

-- ── Self-check ───────────────────────────────────────────────────────────
-- Same idiom as 0034: a table that ends this migration without RLS enabled
-- AND forced fails the migration inside the transaction scripts/db.mjs wraps
-- it in, rather than shipping silently unprotected.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'rate_limits'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;
END $$;
