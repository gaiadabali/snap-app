-- Test fixture for erase_person.test.ts: fills one workspace with a row in
-- (nearly) every tenant table, everything attributed to one person. Created
-- in pg_temp, so it lives only as long as the test's connection.
--
-- pg_temp.seed_workspace(tenant, user, tag) where tag keeps the
-- unique keys (order refs, hashes, codes) distinct per workspace.
CREATE OR REPLACE FUNCTION pg_temp.seed_workspace(t uuid, u uuid, tag text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  acc_asset uuid := gen_random_uuid();
  acc_exp   uuid := gen_random_uuid();
  acc_child uuid := gen_random_uuid();
  tax       uuid := gen_random_uuid();
  cat       uuid := gen_random_uuid();
  cat_child uuid := gen_random_uuid();
  party     uuid := gen_random_uuid();
  cap       uuid := gen_random_uuid();
  cap_stmt  uuid := gen_random_uuid();
  run       uuid := gen_random_uuid();
  layout    uuid := gen_random_uuid();
  doc       uuid := gen_random_uuid();
  doc_stmt  uuid := gen_random_uuid();
  line      uuid := gen_random_uuid();
  txn       uuid := gen_random_uuid();
  fin       uuid := gen_random_uuid();
  stmt      uuid := gen_random_uuid();
  sl        uuid := gen_random_uuid();
  goal      uuid := gen_random_uuid();
  grant_buy uuid := gen_random_uuid();
  grant_vch uuid := gen_random_uuid();
  item      uuid := gen_random_uuid();
  inv       uuid := gen_random_uuid();
  hook      uuid := gen_random_uuid();
  gtax      uuid;
  link      uuid;
BEGIN
  INSERT INTO accounts (id, tenant_id, code, name, account_type) VALUES
    (acc_asset, t, '1-1000-' || tag, 'Bank', 'asset'),
    (acc_exp,   t, '6-1000-' || tag, 'Expenses', 'expense');
  INSERT INTO accounts (id, tenant_id, code, name, account_type, parent_id) VALUES
    (acc_child, t, '6-1100-' || tag, 'Fuel', 'expense', acc_exp);
  INSERT INTO tax_codes (id, tenant_id, code, name, rate) VALUES (tax, t, 'GST-' || tag, 'GST', 0.1);
  INSERT INTO categories (id, tenant_id, name, default_account_id, default_tax_code_id) VALUES
    (cat, t, 'Vehicle ' || tag, acc_exp, tax);
  -- The child category and the bank split use a GLOBAL tax code (tenant_id
  -- NULL), as real workspaces do: erasure must not mistake it for another
  -- workspace's row.
  SELECT g.id INTO gtax FROM tax_codes g WHERE g.tenant_id IS NULL AND g.country = 'AU' ORDER BY g.code LIMIT 1;
  IF gtax IS NULL THEN RAISE EXCEPTION 'seed: no global AU tax code'; END IF;
  INSERT INTO categories (id, tenant_id, name, parent_id, default_tax_code_id) VALUES (cat_child, t, 'Fuel ' || tag, cat, gtax);
  INSERT INTO parties (id, tenant_id, legal_name, name_normalised) VALUES (party, t, 'Shell', 'shell ' || tag);

  -- A receipt: capture, page, extraction run, layout, grounding, document.
  INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256) VALUES
    (cap,      t, u, t || '/r.jpg', 'image/jpeg', 10, digest(tag || 'r', 'sha256')),
    (cap_stmt, t, u, t || '/s.pdf', 'application/pdf', 10, digest(tag || 's', 'sha256'));
  INSERT INTO capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256) VALUES
    (gen_random_uuid(), t, cap, 1, t || '/r-1.jpg', 'image/jpeg', 10, digest(tag || 'p', 'sha256'));
  INSERT INTO extraction_runs (id, tenant_id, capture_id, engine, prompt_version, schema_version) VALUES
    (run, t, cap, (enum_range(NULL::extraction_engine))[1], 'p1', 's1');
  INSERT INTO document_layouts (id, tenant_id, capture_id, storage_key, docdom_version, page_count, extraction_run_id) VALUES
    (layout, t, cap, t || '/layout.json', 'v1', 1, run);
  INSERT INTO document_field_grounding (id, tenant_id, capture_id, layout_id, field_path, value, grounded) VALUES
    (gen_random_uuid(), t, cap, layout, 'total', '11.00', false);
  INSERT INTO documents (id, tenant_id, capture_id, doc_type, created_by, confirmed_by, reviewed_by, current_run_id, supplier_id, category_id) VALUES
    (doc, t, cap, 'receipt', u, u, u, run, party, cat);
  INSERT INTO documents (id, tenant_id, capture_id, doc_type) VALUES (doc_stmt, t, cap_stmt, 'statement');
  INSERT INTO document_lines (id, tenant_id, document_id, line_number, category_id) VALUES (line, t, doc, 1, cat_child);
  INSERT INTO document_tax_subtotals (id, tenant_id, document_id, category_code, rate, taxable_amount, tax_amount) VALUES
    (gen_random_uuid(), t, doc, 'S', 0.1, 10, 1);
  INSERT INTO document_field_corrections (id, tenant_id, document_id, field_path, corrected_by, from_run_id) VALUES
    (gen_random_uuid(), t, doc, 'total', u, run);

  -- A posted, balanced transaction from the receipt, with its observation.
  INSERT INTO transactions (id, tenant_id, txn_date, status, posted_at, posted_by, source, document_id, payee_id) VALUES
    (txn, t, '2026-08-01', 'posted', now(), u, 'scan', doc, party);
  INSERT INTO transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, document_line_id) VALUES
    (gen_random_uuid(), t, txn, 1, acc_exp, 11, tax, line),
    (gen_random_uuid(), t, txn, 2, acc_asset, -11, gtax, NULL);
  INSERT INTO event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_by) VALUES
    (gen_random_uuid(), t, txn, 'document', doc, u);
  INSERT INTO review_tasks (id, tenant_id, reason, document_id, transaction_id, resolved_by) VALUES
    (gen_random_uuid(), t, 'low_confidence', doc, txn, u);

  -- A statement with a line, a match and a goal grounded in it.
  INSERT INTO financial_accounts (id, tenant_id, account_id, institution, account_type, currency) VALUES
    (fin, t, acc_asset, 'Bank', 'savings', 'AUD');
  INSERT INTO statements (id, tenant_id, document_id, financial_account_id, period_start, period_end, opening_balance, closing_balance) VALUES
    (stmt, t, doc_stmt, fin, '2026-08-01', '2026-08-31', 0, 500);
  INSERT INTO statement_lines (id, tenant_id, statement_id, line_number, posted_date, description_raw, amount_signed) VALUES
    (sl, t, stmt, 1, '2026-08-14', 'Salary', 500);
  INSERT INTO match_candidates (id, tenant_id, statement_line_id, document_id, proposed_by, decided_by) VALUES
    (gen_random_uuid(), t, sl, doc, (enum_range(NULL::match_proposer))[1], u);
  INSERT INTO goals (id, tenant_id, name, target) VALUES (goal, t, 'Holiday', 1000);
  INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, source_statement_line_id, created_by) VALUES
    (gen_random_uuid(), t, goal, 100, '2026-08-14', 'statement_line', sl, u);

  -- Credits: a purchase, a spend, and a YourTal voucher redemption.
  INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES
    (grant_buy, t, 'documents', 50, 49, 'purchase');
  INSERT INTO credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, grant_id, paid_at)
    SELECT gen_random_uuid(), t, u, p.code, p.credits, p.price_aud, 'paid', grant_buy, now() FROM credit_packs p LIMIT 1;
  INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid) VALUES
    (t, cap, u, grant_buy, 'purchase', true);
  INSERT INTO yourtal_links (user_id, link_id, region) VALUES (u, gen_random_uuid(), 'AU')
    ON CONFLICT DO NOTHING;
  SELECT l.id INTO link FROM yourtal_links l WHERE l.user_id = u AND l.revoked_at IS NULL LIMIT 1;
  INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES
    (grant_vch, t, 'documents', 50, 50, 'yourtal_voucher');
  INSERT INTO yourtal_voucher_redemptions (user_id, tenant_id, link_row_id, code_sha256, face_minor, credits, merchant_order_ref, status, grant_id, authorization_id, receipt_id, finished_at) VALUES
    (u, t, link, encode(digest(tag || 'v', 'sha256'), 'hex'), 500, 50, 'snap-' || tag, 'granted', grant_vch,
     'auth-' || tag, 'rcpt-' || tag, now());
  -- An open FTR send (0049): its bundle is tax data and must go with the person or the workspace.
  INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, bundle)
    VALUES (t, u, '2025-26', 1, encode(digest(tag || 'f', 'sha256'), 'hex'), '{"k":"deduction-bundle-v1"}');

  -- Sales, stock, bills, trips, budgets.
  INSERT INTO items (id, tenant_id, name) VALUES (item, t, 'Widget');
  INSERT INTO stock_movements (id, tenant_id, item_id, kind, quantity, by_user) VALUES
    (gen_random_uuid(), t, item, (enum_range(NULL::stock_movement_kind))[1], 1, u);
  INSERT INTO invoices (id, tenant_id, number, party_id, issue_date, due_date, created_by) VALUES
    (inv, t, 'INV-' || tag, party, '2026-08-01', '2026-08-31', u);
  INSERT INTO invoice_lines (id, tenant_id, invoice_id, line_number, description, quantity, unit_price, net_amount, gst_amount, total_amount, item_id) VALUES
    (gen_random_uuid(), t, inv, 1, 'Widget', 1, 10, 10, 1, 11, item);
  INSERT INTO payments (id, tenant_id, invoice_id, paid_on, amount, recorded_by) VALUES
    (gen_random_uuid(), t, inv, '2026-08-10', 11, u);
  INSERT INTO bills (id, tenant_id, issue_date, due_date, total_amount, supplier_id, document_id) VALUES
    (gen_random_uuid(), t, '2026-08-01', '2026-08-31', 11, party, doc);
  INSERT INTO trips (id, tenant_id, trip_date, from_place, to_place, km, created_by) VALUES
    (gen_random_uuid(), t, '2026-08-01', 'A', 'B', 10, u);
  INSERT INTO budgets (tenant_id, category) VALUES (t, 'Vehicle ' || tag);

  -- Integrations, keys, queue, invitations.
  INSERT INTO accounting_connections (id, tenant_id, provider, external_tenant_id, access_token, refresh_token, connected_by) VALUES
    (gen_random_uuid(), t, 'xero', 'x-' || tag, '\x01', '\x02', u);
  INSERT INTO api_clients (id, tenant_id, name, key_prefix, key_hash) VALUES
    (gen_random_uuid(), t, 'cli', 'k_' || tag, digest(tag || 'k', 'sha256'));
  INSERT INTO webhook_endpoints (id, tenant_id, url, secret) VALUES (hook, t, 'https://example.com/h', '\x03');
  INSERT INTO webhook_deliveries (id, endpoint_id, event, payload)
    VALUES (gen_random_uuid(), hook, 'document.created', '{}');
  INSERT INTO idempotency_keys (tenant_id, key, request_hash) VALUES (t, 'idem-' || tag, '\x04');
  INSERT INTO usage_counters (tenant_id, period_start, metric) VALUES (t, '2026-08-01', 'documents') ON CONFLICT DO NOTHING;
  INSERT INTO jobs (id, tenant_id, kind) VALUES (gen_random_uuid(), t, 'extract');
  INSERT INTO subscriptions (id, tenant_id, plan_id, provider, current_period_start, current_period_end)
    SELECT gen_random_uuid(), t, p.id, 'manual', now(), now() + interval '30 days' FROM plans p ORDER BY p.id LIMIT 1
    ON CONFLICT DO NOTHING;
  INSERT INTO invitations (id, tenant_id, email, role, token_hash, expires_at, invited_by) VALUES
    (gen_random_uuid(), t, tag || '-invitee@example.com', 'member', digest(tag || 'i', 'sha256'), now() + interval '1 day', u);
END $$;

-- The person's own rows, outside any workspace.
CREATE OR REPLACE FUNCTION pg_temp.seed_person(u uuid, tag text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  link uuid;
BEGIN
  INSERT INTO user_sessions (user_id, token_hash, expires_at, idle_timeout_seconds) VALUES
    (u, digest(tag || 'sess', 'sha256'), now() + interval '1 day', 3600);
  INSERT INTO auth_email_tokens (user_id, purpose, token_hash, email, expires_at)
    SELECT u, (enum_range(NULL::auth_email_token_purpose))[1], digest(tag || 'tok', 'sha256'), email, now() + interval '1 hour'
      FROM users WHERE id = u;
  INSERT INTO point_ledger (id, user_id, delta, reason) VALUES (gen_random_uuid(), u, 10, 'receipt_scanned');
  INSERT INTO yourtal_links (user_id, link_id, region) VALUES (u, gen_random_uuid(), 'AU') ON CONFLICT DO NOTHING;
  SELECT l.id INTO link FROM yourtal_links l WHERE l.user_id = u LIMIT 1;
  INSERT INTO yourtal_outbox (user_id, link_row_id, external_ref, idempotency_key, body) VALUES
    (u, link, 'sha256:' || encode(digest(tag || 'o', 'sha256'), 'hex'), gen_random_uuid(), '{}');
  INSERT INTO mail_deliveries (id, purpose, recipient, subject, outcome)
    SELECT gen_random_uuid(), (enum_range(NULL::mail_purpose))[1], upper(email), 'Hi', 'sent' FROM users WHERE id = u;
END $$;
