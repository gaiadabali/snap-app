-- ---------------------------------------------------------------------------
-- 0037 — the YourTal points link: who is linked, and what is owed a report
--
-- Group plan 2.4 and 2.5. YourTal's side is its partner API
-- (yourtal/docs/developers/partner-api.md): a one-time link code becomes a
-- lasting `linkId`, and each confirmed receipt is reported once under a
-- stable `externalRef`. Founder decision 2026-10-20 (docs/ECOSYSTEM.md D33):
-- YourTal points are the only points with money value, so this is the path by
-- which a Snap Apps scan earns anything at all.
--
-- TWO TABLES, BOTH USER-SCOPED, for the reason `point_ledger` is (0024): a
-- YourTal account belongs to a PERSON, and a workspace means nothing to it.
--
--   yourtal_links   one row per link a user has ever held. At most one is
--                   live per user. Never deleted: "you were linked from X to
--                   Y and it broke because YourTal said link_revoked" is the
--                   support answer, and it needs the history.
--
--   yourtal_outbox  a transactional outbox. A confirmed scan writes a row; the
--                   worker drains it to YourTal. YourTal being down delays a
--                   report and never loses it, and a scan never waits on
--                   YourTal. The row holds the EXACT body bytes that are
--                   signed and sent, and one Idempotency-Key, so every retry
--                   of an event is byte-identical (the partner guide, §4).
--
-- RLS, and who may do what:
--   - the API (app_rw) reads and writes its OWN link rows, and may INSERT
--     and SELECT its own outbox rows. It may never UPDATE or DELETE an outbox
--     row: only the drain decides an event's fate.
--   - the worker (app_worker) reads the outbox ACROSS users — it is a queue,
--     the `jobs` / `mail_deliveries` pattern — and then re-enters as the
--     event's own user (asUser) to read or mark that user's link. The
--     elevated read stays confined to the queue table.
--
-- ADD-ONLY: two new tables, their indexes and policies. Nothing existing is
-- touched.
-- ---------------------------------------------------------------------------

-- ── yourtal_links ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS yourtal_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* YourTal's `linkId`. Not a secret (it is useless without our partner
     secret), but not shown to the user either: they have no use for it. */
  link_id       uuid NOT NULL,
  /* YourTal's answer: the user earns in their own region's points. */
  region        text NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  /* The user unlinked from Snap Apps (YourTal was told first). */
  revoked_at    timestamptz,
  /* YourTal told US the link is gone — the user unlinked in YourTal, deleted
     their YourTal account, or YourTal no longer knows the id. Distinct from
     `revoked_at` because the user did not do it here, and the screen says
     something different ("link again"). */
  broken_at     timestamptz,
  broken_reason text,

  CONSTRAINT yourtal_links_region CHECK (region IN ('AU', 'ID')),
  CONSTRAINT yourtal_links_broken_reason CHECK (
    broken_reason IS NULL OR broken_reason IN ('link_revoked', 'unknown_link')
  ),
  CONSTRAINT yourtal_links_broken_has_reason CHECK ((broken_at IS NULL) = (broken_reason IS NULL))
);

-- At most one LIVE link per user.
CREATE UNIQUE INDEX IF NOT EXISTS yourtal_links_one_live_per_user
  ON yourtal_links (user_id)
  WHERE revoked_at IS NULL AND broken_at IS NULL;

-- At most one live Snap Apps account per YourTal link. YourTal keeps ONE link
-- per YourTal user per partner and hands the same `linkId` back to a second
-- exchange, so without this two Snap Apps accounts could share a link — and
-- unlinking either would revoke it for both. Enforced by the index rather than
-- by a read the API cannot make anyway: RLS hides the other account's row.
CREATE UNIQUE INDEX IF NOT EXISTS yourtal_links_one_live_per_link
  ON yourtal_links (link_id)
  WHERE revoked_at IS NULL AND broken_at IS NULL;

CREATE INDEX IF NOT EXISTS yourtal_links_by_user
  ON yourtal_links (user_id, linked_at DESC);

-- ── yourtal_outbox ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS yourtal_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* The link the event was queued under. Its `link_id` is already inside
     `body`; this is what lets the drain see that the link has since been
     revoked or broken and stop. */
  link_row_id      uuid NOT NULL REFERENCES yourtal_links (id) ON DELETE CASCADE,
  /* The capture that produced the receipt, for support. No foreign key:
     captures are tenant rows and this table is not. */
  capture_id       uuid,
  action           text NOT NULL DEFAULT 'receipt_scanned',
  /* SHA-256 of the stored original's bytes (apps/server/src/yourtal/
     external-ref.ts). YourTal pays a receipt once per partner on this. */
  external_ref     text NOT NULL,
  /* One per event, stable across every retry of it. */
  idempotency_key  uuid NOT NULL UNIQUE,
  /* The exact JSON text that is signed and sent, serialised once at enqueue. */
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  locked_by        text,
  /* What YourTal last said, for an operator. Never the request body or a
     header: the Authorization header carries a signature over the body. */
  last_http_status integer,
  last_code        text,
  last_error       text,
  /* A `skipped_duplicate` row: the capture already reported for this user
     that this one looks like a re-photo of (same supplier, date and amount
     in the workspace). Never sent. */
  duplicate_of_capture_id uuid,
  /* YourTal's answer on success. */
  granted          boolean,
  points           integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,

  CONSTRAINT yourtal_outbox_action CHECK (action IN ('receipt_scanned')),
  CONSTRAINT yourtal_outbox_ref CHECK (length(external_ref) BETWEEN 1 AND 200),
  CONSTRAINT yourtal_outbox_attempts CHECK (attempts >= 0),
  CONSTRAINT yourtal_outbox_status CHECK (status IN (
    'pending',      -- waiting for its next attempt
    'sent',         -- 200, a new report
    'duplicate',    -- 200 with duplicate: true — success, nothing new paid
    'refused',      -- a ledger refusal (velocity_capped, ...): final, logged
    'link_broken',  -- 403 link_revoked / 400 unknown_link: the link is marked broken
    'cancelled',    -- its link was unlinked or broken before it was sent
    'failed',       -- any other 4xx: final, logged, needs a person
    'dead',         -- retries exhausted: kept for a person to requeue
    'skipped_duplicate' -- never sent: a likely re-photo of a receipt already
                        -- reported for this user (founder decision 2026-10-20)
  )),
  CONSTRAINT yourtal_outbox_finished CHECK ((status = 'pending') = (finished_at IS NULL)),
  -- Once per receipt per user, enforced: a re-extraction or a retried scan
  -- queues nothing new.
  CONSTRAINT yourtal_outbox_once_per_receipt UNIQUE (user_id, action, external_ref)
);

-- The drain's query.
CREATE INDEX IF NOT EXISTS yourtal_outbox_due
  ON yourtal_outbox (next_attempt_at)
  WHERE status = 'pending';

-- The status endpoint's query.
CREATE INDEX IF NOT EXISTS yourtal_outbox_by_user
  ON yourtal_outbox (user_id, status);

CREATE INDEX IF NOT EXISTS yourtal_outbox_by_link
  ON yourtal_outbox (link_row_id)
  WHERE status = 'pending';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE yourtal_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_links  FORCE  ROW LEVEL SECURITY;
ALTER TABLE yourtal_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_outbox FORCE  ROW LEVEL SECURITY;

-- Links: the signed-in user's own rows, nobody else's. The worker is a member
-- of app_rw, so it reaches these only after `asUser(event.user_id)`.
CREATE POLICY yourtal_links_self_read ON yourtal_links
  FOR SELECT TO app_rw
  USING (user_id = current_user_id());
CREATE POLICY yourtal_links_self_insert ON yourtal_links
  FOR INSERT TO app_rw
  WITH CHECK (user_id = current_user_id());
CREATE POLICY yourtal_links_self_update ON yourtal_links
  FOR UPDATE TO app_rw
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- Outbox: the API may queue and read its own events. The link named must be
-- the caller's own, so one user can never queue a report against another
-- user's link (the subquery runs under the caller's RLS, which already hides
-- every other user's link). And a new row can only be what the queueing code
-- writes — pending, or skipped as a likely duplicate — never an outcome:
-- only the drain records what YourTal answered.
CREATE POLICY yourtal_outbox_self_read ON yourtal_outbox
  FOR SELECT TO app_rw
  USING (user_id = current_user_id());
CREATE POLICY yourtal_outbox_self_insert ON yourtal_outbox
  FOR INSERT TO app_rw
  WITH CHECK (
    user_id = current_user_id()
    AND status IN ('pending', 'skipped_duplicate')
    AND attempts = 0
    AND granted IS NULL AND points IS NULL
    AND locked_at IS NULL AND last_http_status IS NULL
    AND EXISTS (
      SELECT 1 FROM yourtal_links l
       WHERE l.id = link_row_id AND l.user_id = current_user_id()
    )
  );

-- The drain: every row, because it is a queue consumer.
CREATE POLICY yourtal_outbox_worker ON yourtal_outbox
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

-- Grants, narrowed at both layers. The default ACL gives app_rw arwd on every
-- new table (see 0034), so revoke first and grant exactly what is meant.
REVOKE ALL ON yourtal_links, yourtal_outbox FROM app_rw;
REVOKE ALL ON yourtal_links, yourtal_outbox FROM app_readonly;
GRANT SELECT, INSERT, UPDATE ON yourtal_links  TO app_rw;
GRANT SELECT, INSERT         ON yourtal_outbox TO app_rw;
GRANT SELECT, INSERT, UPDATE ON yourtal_outbox TO app_worker;

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Fails the migration inside db.mjs's transaction rather than shipping a table
-- that is not protected the way this header says.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('yourtal_links', 'yourtal_outbox')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  -- app_rw must never be able to change or remove an outbox row, nor remove
  -- a link row: the history is the support record.
  SELECT string_agg(table_name || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_rw'
     AND ((table_name = 'yourtal_outbox' AND privilege_type NOT IN ('SELECT', 'INSERT'))
       OR (table_name = 'yourtal_links'  AND privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_rw holds more than intended on the YourTal tables: %', bad;
  END IF;
END $$;
