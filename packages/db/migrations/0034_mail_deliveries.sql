-- ---------------------------------------------------------------------------
-- 0034 — mail_deliveries: what happened to every message we tried to send
--
-- docs/INTEGRATIONS.md Lane N, ticket N3.
--
-- WHY THIS TABLE EXISTS AT ALL, AND WHY IT IS SPECIFIC TO SMTP. A provider
-- API (Postmark, SES, Resend) reports a bounce asynchronously over a webhook
-- minutes later. Generic SMTP — the transport the owner chose on 2026-09-21
-- — has no webhook: the ONLY delivery signal that will ever exist is the
-- reply to the send itself, at DATA time. If that reply is not written down
-- at the moment it arrives, it is gone.
--
-- So without this table the system has no answer to "did that magic link go
-- out", and the failure is invisible precisely where it is least visible
-- already: `auth.controller.ts` deliberately returns the SAME 200 whether
-- the address exists, the mailer is misconfigured, or the provider dropped
-- the message. That identical response is a security property (it closes an
-- account-enumeration oracle) and it is also what makes a silent mail outage
-- undetectable from the outside. This table is the inside view.
--
-- NOT TENANT-SCOPED, deliberately. A magic-link send happens BEFORE anyone
-- is authenticated, for an address that may belong to no user at all, so
-- there is no tenant to scope it to. It therefore follows the `jobs` pattern
-- from 0010 rather than the tenant_isolation loop: RLS on and forced, a
-- permissive policy for `app_worker` only, and — see below — app_rw may
-- INSERT but may never SELECT.
--
-- THE APP CANNOT READ THIS TABLE, AND THAT IS THE POINT. It holds a row per
-- attempted recipient, including addresses that have no account. A SELECT
-- policy for app_rw would make any endpoint that ever joined against it a
-- working answer to "does this address have an account here" — reintroducing,
-- through the back door, exactly the enumeration oracle the identical-200 was
-- built to close. The API writes; the worker and an operator read.
-- ---------------------------------------------------------------------------

-- What the send was for. Not free text: a new kind of mail should be a
-- deliberate addition here, because each one implies a decision about
-- whether it may be retried (see `mail_retryable` below).
DO $$ BEGIN
  CREATE TYPE mail_purpose AS ENUM ('magic_link', 'firm_invite', 'notification');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The three outcomes `auth/smtp-mailer.ts` classifies into. They exist as an
-- enum rather than a boolean because "failed" is not one thing: a 550 must
-- never be retried and a 421 must be, and collapsing them is the specific
-- bug this whole lane is built to avoid.
DO $$ BEGIN
  CREATE TYPE mail_outcome AS ENUM ('sent', 'transient', 'permanent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mail_deliveries (
  id            uuid PRIMARY KEY,
  purpose       mail_purpose NOT NULL,
  /* The envelope recipient. Stored in full because an operator debugging
     "my link never arrived" needs to match on it exactly, and a hash cannot
     be matched against a support ticket. The protection is the absence of a
     SELECT policy for app_rw, not obfuscation of the column. */
  recipient     text NOT NULL,
  subject       text NOT NULL,
  outcome       mail_outcome NOT NULL,
  /* The SMTP reply code when the server gave one. NULL for a failure that
     never got a reply — a refused connection, a TLS failure — which is a
     meaningful distinction and not a missing value. */
  smtp_code     int,
  /* The error text as the transport reported it. Never the message body:
     a magic-link body contains a live bearer token, and this table is
     retained long after the token expires. */
  last_error    text,
  attempts      int NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),

  /* A code only makes sense on a failure the server answered, and 'sent'
     must never carry an error. Both directions, because a row that says it
     succeeded AND carries an error is a row nobody can interpret. */
  CONSTRAINT mail_sent_has_no_error CHECK (outcome <> 'sent' OR last_error IS NULL)
);

-- The operator's query: what failed recently, worst first.
CREATE INDEX IF NOT EXISTS mail_deliveries_failures_idx
  ON mail_deliveries (last_attempt_at DESC)
  WHERE outcome <> 'sent';

-- The support query: "did anything go to this address".
CREATE INDEX IF NOT EXISTS mail_deliveries_recipient_idx
  ON mail_deliveries (lower(recipient), last_attempt_at DESC);

-- ── RLS, following 0010's `jobs` pattern ─────────────────────────────────

ALTER TABLE mail_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_deliveries FORCE  ROW LEVEL SECURITY;

-- The worker sees everything: it is what retries a transient failure, and
-- a retry consumer must read across every row the same way it reads `jobs`.
CREATE POLICY mail_deliveries_worker ON mail_deliveries
  FOR ALL
  TO app_worker
  USING (true)
  WITH CHECK (true);

-- The API may record an attempt and NOTHING else. There is deliberately no
-- USING clause anywhere for app_rw, so SELECT, UPDATE and DELETE all match
-- no policy and return nothing. See the header: a readable mail log is an
-- account-enumeration oracle wearing a different hat.
CREATE POLICY mail_deliveries_app_insert ON mail_deliveries
  FOR INSERT
  TO app_rw
  WITH CHECK (true);

-- REVOKE FIRST. This is not defensive noise, and it was found by checking
-- rather than by reading: this database carries a DEFAULT ACL
-- (`app_rw=arwd/postgres`) that grants app_rw insert, select, update AND
-- delete on every table postgres creates. So a bare `GRANT INSERT ... TO
-- app_rw` grants nothing new and, worse, READS like a restriction while
-- leaving the other three in place.
--
-- RLS is still the effective control — with no USING clause for app_rw, a
-- SELECT returns zero rows and an UPDATE touches none, which is exactly
-- what was observed. But relying on that alone means one permissive policy
-- added later, by someone who assumes the grants are already narrow, opens
-- everything. Revoking makes the intent true at both layers.
REVOKE ALL ON mail_deliveries FROM app_rw;
GRANT INSERT ON mail_deliveries TO app_rw;
GRANT SELECT, INSERT, UPDATE ON mail_deliveries TO app_worker;

-- Explicitly NOT granted to app_readonly. The reporting role has no business
-- with a list of every address that ever requested a sign-in link.
REVOKE ALL ON mail_deliveries FROM app_readonly;

-- ── Self-check ───────────────────────────────────────────────────────────
-- Same idiom as 0031: if the table ends this migration without RLS enabled
-- AND forced, the whole migration fails inside the transaction scripts/db.mjs
-- wraps it in, rather than shipping a table that silently is not protected.
--
-- The second clause is the one specific to this table: it asserts that no
-- policy grants app_rw a USING clause. A permissive SELECT added later by
-- accident — the easy mistake, since every other table in this schema has
-- one — would reopen the enumeration oracle, so it fails the migration here
-- rather than being caught in review.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'mail_deliveries'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  SELECT string_agg(pol.polname, ', ') INTO bad
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'mail_deliveries'
     AND pol.polqual IS NOT NULL
     AND 'app_rw'::regrole = ANY (pol.polroles);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'mail_deliveries grants app_rw a readable policy (%): that is an account-enumeration oracle, see this migration''s header',
      bad;
  END IF;

  -- And the grant layer, for the same reason. The DEFAULT ACL noted above
  -- means this is easy to get wrong by doing nothing at all, so it is
  -- asserted rather than assumed: app_rw must hold INSERT and nothing else.
  SELECT string_agg(privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name = 'mail_deliveries'
     AND grantee = 'app_rw'
     AND privilege_type <> 'INSERT';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'app_rw holds % on mail_deliveries; it may hold INSERT only (the default ACL grants arwd — revoke it)',
      bad;
  END IF;
END $$;
