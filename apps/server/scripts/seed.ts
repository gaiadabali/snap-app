/**
 * Seeds the demo accounts and workspaces.
 *
 *   pnpm --filter @snap/server seed
 *
 * Mirrors the mobile fixture's people and workspaces so the same demo script
 * works against the real server: Kate owns both, Jem is household-only, Dan is
 * Staff and therefore cannot post to the ledger.
 *
 * Idempotent — safe to run repeatedly against the same database.
 *
 * MUST be run with an admin connection, not the application's.
 *
 * Creating tenants and users is a privileged operation, the same class of
 * thing as a migration: the app role is NOSUPERUSER NOBYPASSRLS and there is
 * no tenant context a fixture loader could run in. Pointed at the application
 * role it fails with "new row violates row-level security policy", which is
 * the database being right, so this checks first and says so in words.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../src/db.js';
import { seedDefaultCategories } from '../src/settings/settings.repo.js';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

const PEOPLE = [
  { id: '33333333-3333-4333-8333-333333333331', name: 'Kate Marsh', email: 'kate@marshtransport.example' },
  { id: '33333333-3333-4333-8333-333333333332', name: 'Sam Oyelaran', email: 'sam@marshtransport.example' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Dan Whitby', email: 'dan@marshtransport.example' },
  { id: '33333333-3333-4333-8333-333333333334', name: 'Jem Marsh', email: 'jem@example.com' },
  { id: '33333333-3333-4333-8333-333333333335', name: 'Priya Nandan', email: 'priya@marshaccountants.example' },
  // The worker acts as a user so its writes go through the same
  // membership-verified path as everyone else's. No special case, no bypass.
  { id: '44444444-4444-4444-8444-444444444444', name: 'Extraction worker', email: 'worker@snapapps.internal' },
];

const MEMBERSHIPS: Array<[string, string, string]> = [
  [BUSINESS, PEOPLE[0]!.id, 'owner'],
  [BUSINESS, PEOPLE[1]!.id, 'admin'],
  [BUSINESS, PEOPLE[2]!.id, 'member'],
  [BUSINESS, PEOPLE[4]!.id, 'readonly'],
  [BUSINESS, PEOPLE[5]!.id, 'member'],
  [HOUSEHOLD, PEOPLE[0]!.id, 'owner'],
  [HOUSEHOLD, PEOPLE[3]!.id, 'admin'],
  [HOUSEHOLD, PEOPLE[5]!.id, 'member'],
];

const db = getDb();

// Fail with a sentence rather than a policy violation forty rows in.
{
  const who = await db.execute<{ privileged: boolean; role: string }>(sql`
    select current_user as role,
           coalesce((select bool_or(rolsuper or rolbypassrls) from pg_roles
                      where rolname = current_user), false) as privileged
  `);
  const row = who.rows[0];
  if (row && !row.privileged) {
    console.error(
      [
        `seed: connected as "${row.role}", which is subject to row-level security.`,
        'The seed creates tenants and users, which no tenant policy permits.',
        'Run it with the admin DATABASE_URL (the one `node scripts/db.mjs up` prints),',
        'not the snap_app one the API uses.',
      ].join('\n'),
    );
    await closeDb();
    process.exit(1);
  }
}

await db.execute(sql`
  insert into tenants (id, name, kind, abn, gst_registered, gst_basis, country, base_currency, occupation_profile_id)
  values (${BUSINESS}, 'K. Marsh Transport', 'business', '51824753556', true, 'cash', 'AU', 'AUD', 'truckie_long')
  on conflict (id) do update set name = excluded.name
`);

// A personal workspace has no ABN and cannot be GST-registered — the CHECK
// added in migration 0012 enforces it, so this would fail loudly if wrong.
await db.execute(sql`
  insert into tenants (id, name, kind, country, base_currency)
  values (${HOUSEHOLD}, 'Marsh Household', 'personal', 'AU', 'AUD')
  on conflict (id) do update set name = excluded.name
`);

for (const person of PEOPLE) {
  await db.execute(sql`
    insert into users (id, subject, email, display_name)
    values (${person.id}, ${`dev|${person.email}`}, ${person.email}, ${person.name})
    on conflict (id) do update set display_name = excluded.display_name
  `);
}

for (const [tenant, user, role] of MEMBERSHIPS) {
  await db.execute(sql`
    insert into memberships (tenant_id, user_id, role)
    values (${tenant}, ${user}, ${role})
    on conflict (tenant_id, user_id) do update set role = excluded.role
  `);
}

// The category list each workspace starts with. Seeded through the SAME
// function the onboarding endpoint uses, rather than a list written out again
// here — a demo workspace whose categories differ from a real one's is a demo
// that proves nothing.
await seedDefaultCategories(PEOPLE[0]!.id, BUSINESS, 'business');
await seedDefaultCategories(PEOPLE[0]!.id, HOUSEHOLD, 'personal');

// A plan, so quota and seat limits have something to read.
// `provider` is NOT NULL: every subscription came from somewhere, and a
// subscription with no billing provider is a row nobody can reconcile against
// a payout later. Seeded as 'manual', which is what a demo tenant actually is.
await db.execute(sql`
  insert into subscriptions (
    id, tenant_id, plan_id, status, provider, current_period_start, current_period_end
  )
  select ${randomUUID()}, ${BUSINESS}, p.id, 'active', 'manual', now(), now() + interval '30 days'
    -- The pro plan (10 seats), not practice (1 seat). The demo workspace has
    -- five people in it, and seeding a five-person team onto a single-seat
    -- plan made every invitation fail with a seat-limit error that was
    -- correct and baffling. The mobile fixture claimed five seats on
    -- practice; the plans table is the authority and it says one.
    from plans p where p.code = 'pro'
   on conflict do nothing
`);

/* ── The business side ────────────────────────────────────────────────────
 *
 * Invoices, payments and trips. Seeded because without them `/v1/sales` and
 * `/v1/mileage` answer with honest zeroes, which is indistinguishable from
 * answering correctly — the endpoints looked fine and were never exercised.
 *
 * Amounts are computed the same way the product computes them: GST is 10%
 * ADDED to a sale, never 1/11 of it. (1/11 is what you take OUT of a
 * GST-inclusive purchase; the two are not interchangeable and mixing them up
 * is a BAS that is wrong by about 9%.)
 */

const CUSTOMERS = [
  { id: 'aa000000-0000-4000-8000-000000000001', name: 'Northline Freight', abn: '51824753556' },
  { id: 'aa000000-0000-4000-8000-000000000002', name: 'Riverina Cold Store', abn: '33051775556' },
];

for (const c of CUSTOMERS) {
  await db.execute(sql`
    insert into parties (id, tenant_id, legal_name, name_normalised, abn, kind)
    values (${c.id}, ${BUSINESS}, ${c.name}, ${c.name.toLowerCase()}, ${c.abn}, 'customer')
    on conflict (id) do update set legal_name = excluded.legal_name
  `);
}

/** Days before today, as a date literal. */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const INVOICES = [
  // Paid in full: contributes to "paid this quarter", not to what is owed.
  { n: 'INV-1041', customer: 0, net: '4200.00', issued: 20, due: 6,  paid: '4620.00' },
  // Sent and not yet due: outstanding, not overdue.
  { n: 'INV-1042', customer: 1, net: '1850.00', issued: 9,  due: -12, paid: null },
  // Past its due date with nothing against it: genuinely overdue.
  { n: 'INV-1043', customer: 0, net: '2640.00', issued: 40, due: 11, paid: null },
  // Part paid AND past due. The balance is what is overdue, not the total —
  // this row is the reason `amount_due` is summed from payments rather than
  // stored on the invoice.
  { n: 'INV-1044', customer: 1, net: '3100.00', issued: 52, due: 23, paid: '1500.00' },
  // A draft. Nobody has been asked to pay it, so it is neither owed to us nor
  // GST we have charged, and every figure must exclude it.
  { n: 'INV-1045', customer: 0, net: '990.00',  issued: 3,  due: -25, paid: null, draft: true },
];

for (const inv of INVOICES) {
  const id = randomUUID();
  const net = inv.net;
  const gst = (Number(net) * 0.1).toFixed(4);      // 10% ADDED on a sale.
  const total = (Number(net) * 1.1).toFixed(4);
  const paidInFull = inv.paid !== null && Number(inv.paid) >= Number(total) - 0.005;
  const status = inv.draft
    ? 'draft'
    : paidInFull
      ? 'paid'
      : inv.due > 0
        ? 'overdue'
        : 'sent';

  await db.execute(sql`
    insert into invoices (
      id, tenant_id, number, kind, status, party_id, issue_date, due_date,
      net_amount, gst_amount, total_amount, created_by
    )
    values (
      ${id}, ${BUSINESS}, ${inv.n}, 'invoice', ${status}::invoice_status,
      ${CUSTOMERS[inv.customer]!.id}, ${daysAgo(inv.issued)}::date, ${daysAgo(inv.due)}::date,
      ${net}, ${gst}, ${total}, ${PEOPLE[0]!.id}
    )
    on conflict do nothing
  `);
  await db.execute(sql`
    insert into invoice_lines (
      id, tenant_id, invoice_id, line_number, description, unit,
      quantity, unit_price, net_amount, gst_amount, total_amount
    )
    values (
      ${randomUUID()}, ${BUSINESS}, ${id}, 1, 'Line-haul freight', 'km',
      1, ${net}, ${net}, ${gst}, ${total}
    )
    on conflict do nothing
  `);
  if (inv.paid) {
    await db.execute(sql`
      insert into payments (id, tenant_id, invoice_id, paid_on, amount, method, recorded_by)
      values (${randomUUID()}, ${BUSINESS}, ${id}, ${daysAgo(Math.max(0, inv.due - 2))}::date,
              ${inv.paid}, 'bank', ${PEOPLE[0]!.id})
      on conflict do nothing
    `);
  }
}

const TRIPS = [
  { d: 2,  from: 'Goulburn depot',  to: 'Sydney markets',   km: '196.4', why: 'Line-haul delivery',  work: true },
  { d: 5,  from: 'Goulburn depot',  to: 'Canberra',         km: '92.8',  why: 'Customer drop',       work: true },
  { d: 9,  from: 'Goulburn depot',  to: 'Wagga Wagga',      km: '243.1', why: 'Line-haul delivery',  work: true },
  { d: 14, from: 'Home',            to: 'Goulburn depot',   km: '11.2',  why: 'Commute',             work: false },
  { d: 21, from: 'Goulburn depot',  to: 'Melbourne',        km: '648.5', why: 'Interstate run',      work: true },
];

for (const t of TRIPS) {
  await db.execute(sql`
    insert into trips (id, tenant_id, trip_date, from_place, to_place, km, purpose,
                       work_related, source, created_by)
    values (${randomUUID()}, ${BUSINESS}, ${daysAgo(t.d)}::date, ${t.from}, ${t.to},
            ${t.km}, ${t.why}, ${t.work}, 'manual', ${PEOPLE[0]!.id})
    on conflict do nothing
  `);
}

console.log('seeded');
console.log(`  business   ${BUSINESS}  K. Marsh Transport`);
console.log(`  household  ${HOUSEHOLD}  Marsh Household`);
console.log(`  worker     ${PEOPLE[5]!.id}  (set WORKER_USER_ID to this)`);
console.log('\n  sign in as any of:');
for (const person of PEOPLE.slice(0, 5)) {
  const roles = MEMBERSHIPS.filter((m) => m[1] === person.id)
    .map(([t, , r]) => `${t === BUSINESS ? 'business' : 'household'}:${r}`)
    .join(', ');
  console.log(`    ${person.email.padEnd(38)} ${roles}`);
}

await closeDb();
