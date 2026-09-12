-- 0022_admin_user_detail
--
-- One user, by id, with the workspaces they belong to.
--
-- WHY THIS EXISTS. 0021 shipped `admin_user_search`, which substring-matches
-- name and email, and nothing that fetches a single user by id. The admin
-- console's user-detail page therefore had to PAGE THROUGH the search looking
-- for a matching row: twenty round trips to render one page, and — the real
-- problem — a page that silently stops finding anybody once the platform has
-- more users than the scan bound. A detail page that quietly 404s on a real
-- user, only past a certain table size, is the kind of failure that is
-- invisible in development and reported as "it worked yesterday" in
-- production.
--
-- It also returns the memberships, which the console previously could not show
-- at all: `AdminUserSummary` carried a tenant COUNT and no way to learn which
-- tenants. Staff starting an impersonation session had to search for the
-- tenant separately and guess whether the pair was valid.
--
-- Same discipline as every other function in 0021: SECURITY DEFINER owned by
-- `app_platform`, the capability re-checked HERE rather than trusted from the
-- API guard, and the read audited. Metadata only — this is not a route to a
-- user's financial records, which still goes through
-- `admin_authorize_tenant_records` and a typed reason.

CREATE OR REPLACE FUNCTION admin_user_detail(p_user_id uuid)
RETURNS TABLE (
  user_id      uuid,
  email        text,
  display_name text,
  created_at   timestamptz,
  tenant_count bigint,
  memberships  jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_tenant_metadata') THEN
    RAISE EXCEPTION 'missing capability: view_tenant_metadata' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'no such user' USING ERRCODE = 'no_data_found';
  END IF;

  -- `tenant_id` is null: this read is about a person, not one workspace, and
  -- inventing a tenant here would put the row in some arbitrary tenant's
  -- audit trail.
  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (NULL, 'platform_staff', current_user_id(), 'admin_view_user_metadata',
          'user', p_user_id, jsonb_build_object('staff_user_id', current_user_id()));

  RETURN QUERY
  SELECT u.id,
         u.email::text,
         u.display_name,
         u.created_at,
         (SELECT count(*) FROM memberships m WHERE m.user_id = u.id),
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                     'tenantId',   t.id,
                     'tenantName', t.name,
                     'kind',       t.kind,
                     'role',       m.role,
                     'joinedAt',   m.created_at
                   ) ORDER BY t.name)
              FROM memberships m
              JOIN tenants t ON t.id = m.tenant_id
             WHERE m.user_id = u.id),
           '[]'::jsonb)
    FROM users u
   WHERE u.id = p_user_id;
END $fn$;

ALTER FUNCTION admin_user_detail(uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION admin_user_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_detail(uuid) TO app_rw;
