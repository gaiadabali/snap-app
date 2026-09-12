-- ---------------------------------------------------------------------------
-- 0014 — The business side, and the personal side
--
-- Everything the app has been modelling against fixtures: what you sell, what
-- you are owed, what you owe, the trips you drove, and what a household
-- intends to spend. The mobile client has had screens for all of it for weeks;
-- this is the schema those screens were always going to need.
--
-- Two deliberate positions, both of which cost a little now and save a lot:
--
--  1. **Money is never a float.** Every amount uses the `money_amount` domain
--     (NUMERIC, 4dp) established in 0001. A cent lost to binary floating point
--     is a BAS that does not reconcile, and it is unrecoverable after the fact.
--
--  2. **Totals are stored, not only derived.** An invoice's net, GST and total
--     are columns. They are what was SENT to a customer — if a price or a rate
--     changes next year, recomputing from the lines would silently rewrite a
--     document someone has already paid. The lines justify the total; they do
--     not define it retrospectively.
-- ---------------------------------------------------------------------------

-- ── Items: what you sell ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name           text NOT NULL,
  sku            text,
  unit           text NOT NULL DEFAULT 'ea',   -- UN/ECE Rec 20 where it maps

  sell_price     unit_price NOT NULL DEFAULT 0,  -- ex-GST: GST is ADDED on a sale
  cost_price     unit_price NOT NULL DEFAULT 0,

  -- NULL means a service, which is different from a product with none in
  -- stock. A stock take must not invent a count for labour.
  stock_on_hand  quantity,
  low_stock_at   quantity NOT NULL DEFAULT 6,

  tax_code       text NOT NULL DEFAULT 'GSTONINCOME',
  active         boolean NOT NULL DEFAULT true,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT items_sku_unique UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS items_tenant_idx ON items (tenant_id) WHERE active;

-- ── Stock movements: why the count is what it is ───────────────────────────

DO $$ BEGIN
  CREATE TYPE stock_movement_kind AS ENUM ('count', 'sale', 'purchase', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stock_movements (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,

  kind        stock_movement_kind NOT NULL,
  -- Signed: negative is stock leaving. A count records the DIFFERENCE it
  -- caused, not the number counted, so the history explains the balance.
  quantity    quantity NOT NULL,
  note        text,
  by_user     uuid REFERENCES users(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON stock_movements (tenant_id, item_id, at DESC);

-- ── Invoices and estimates: money in ───────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE invoice_kind AS ENUM ('invoice', 'estimate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  number         text NOT NULL,
  kind           invoice_kind NOT NULL DEFAULT 'invoice',
  status         invoice_status NOT NULL DEFAULT 'draft',

  party_id       uuid NOT NULL REFERENCES parties(id),
  issue_date     date NOT NULL,
  due_date       date NOT NULL,

  net_amount     money_amount NOT NULL DEFAULT 0,
  gst_amount     money_amount NOT NULL DEFAULT 0,
  total_amount   money_amount NOT NULL DEFAULT 0,

  -- The estimate this was converted from, if any. A copy, not a mutation: the
  -- estimate stays on file as what the customer actually agreed to.
  converted_from uuid REFERENCES invoices(id),

  notes          text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,

  -- A customer reconciles against the number. A duplicate or a gap in the
  -- series is a question somebody has to answer.
  CONSTRAINT invoices_number_unique UNIQUE (tenant_id, number),
  CONSTRAINT invoices_due_after_issue CHECK (due_date >= issue_date),
  -- The three totals must agree. Enforced here because an invoice whose parts
  -- do not add up is not a document anyone can act on.
  CONSTRAINT invoices_totals_add_up CHECK (total_amount = net_amount + gst_amount)
);

CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices (tenant_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS invoices_open_idx ON invoices (tenant_id, due_date)
  WHERE status IN ('sent', 'overdue');

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  line_number  int NOT NULL,
  item_id      uuid REFERENCES items(id),
  description  text NOT NULL,
  unit         text NOT NULL DEFAULT 'ea',
  quantity     quantity NOT NULL,
  unit_price   unit_price NOT NULL,

  net_amount   money_amount NOT NULL,
  gst_amount   money_amount NOT NULL,
  total_amount money_amount NOT NULL,

  UNIQUE (invoice_id, line_number)
);

-- ── Payments received ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('bank', 'card', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- Always against an invoice, never free-standing. That is what lets
  -- "outstanding" be derived rather than maintained, and two separately
  -- maintained figures are two figures that will disagree.
  paid_on     date NOT NULL,
  amount      money_amount NOT NULL CHECK (amount > 0),
  method      payment_method NOT NULL DEFAULT 'bank',
  reference   text,

  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (tenant_id, invoice_id);

-- ── Bills: money out, with a date on it ────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE bill_status AS ENUM ('unpaid', 'paid', 'overdue', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bills (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Distinct from a `document`: a receipt proves you already paid and defends
  -- a GST credit; a bill is an obligation and the only question is when.
  supplier_id  uuid REFERENCES parties(id),
  reference    text,
  issue_date   date NOT NULL,
  due_date     date NOT NULL,

  total_amount money_amount NOT NULL,
  gst_amount   money_amount NOT NULL DEFAULT 0,
  amount_paid  money_amount NOT NULL DEFAULT 0,

  status       bill_status NOT NULL DEFAULT 'unpaid',
  category     text,

  -- Set when a receipt for this bill is captured, linking obligation to proof.
  document_id  uuid REFERENCES documents(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bills_due_after_issue CHECK (due_date >= issue_date),
  CONSTRAINT bills_not_overpaid CHECK (amount_paid <= total_amount)
);

CREATE INDEX IF NOT EXISTS bills_due_idx ON bills (tenant_id, due_date) WHERE status <> 'paid';

-- ── Trips: the logbook behind a D1 claim ───────────────────────────────────

CREATE TABLE IF NOT EXISTS trips (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  trip_date    date NOT NULL,
  from_place   text NOT NULL,
  to_place     text NOT NULL,
  km           quantity NOT NULL CHECK (km > 0),
  purpose      text,

  -- False for private travel, including the commute between home and a regular
  -- workplace — which is private under ATO rules even in a work vehicle.
  work_related boolean NOT NULL DEFAULT true,
  -- 'gps' or 'manual'. A logbook the ATO may ask about should say how it was
  -- measured, not merely what it claims.
  source       text NOT NULL DEFAULT 'manual',

  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trips_date_idx ON trips (tenant_id, trip_date DESC);

-- ── Budgets and goals: the personal side ───────────────────────────────────

CREATE TABLE IF NOT EXISTS budgets (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category   text NOT NULL,
  monthly    money_amount NOT NULL DEFAULT 0 CHECK (monthly >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, category)
);

CREATE TABLE IF NOT EXISTS goals (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name        text NOT NULL,
  target      money_amount NOT NULL CHECK (target > 0),
  saved       money_amount NOT NULL DEFAULT 0 CHECK (saved >= 0),
  target_date date,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goals_tenant_idx ON goals (tenant_id);

-- ── Row-level security ─────────────────────────────────────────────────────
-- The same policy as every other tenant-scoped table (0010). Applied in a loop
-- over an explicit list so a security review has one place to look, and so a
-- table added here cannot be quietly left unprotected.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'items', 'stock_movements', 'invoices', 'invoice_lines',
    'payments', 'bills', 'trips', 'budgets', 'goals'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_readonly', t);
  END LOOP;
END $$;
