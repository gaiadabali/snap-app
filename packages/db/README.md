# @snap/db

Snap Apps database layer. **SERVER ONLY** — never a dependency of the mobile app
(enforced by `test/boundaries.test.ts` at the repo root).

```
25 tables · 11 enums · 7 domains · 10 migrations · 68 tests
```

---

## The arrangement: SQL is the source of truth

Hand-authored SQL in `migrations/` defines the schema. The Drizzle declarations in
`src/schema/` are a **typed query layer over it**, not the schema author.

That is deliberate. `drizzle-kit generate` cannot express what this schema depends on:

| Feature | Where it lives |
|---|---|
| 7 Postgres `DOMAIN`s (`money_amount`, `currency_code`, …) | `0001` |
| `abn_is_valid()` IMMUTABLE plpgsql + generated columns | `0001`, `0002`, `0004` |
| `DEFERRABLE INITIALLY DEFERRED` sum-zero ledger trigger | `0006` |
| `security_invoker` views (`v_bas_lines`, …) | `0006`, `0008`, `0010` |
| Human-review field-lock trigger | `0009` |
| RLS policies, roles, grants | `0010` |
| Partial unique indexes | throughout |

The cost of that choice is that the TS declarations could drift from the SQL. That gap is
closed by a test rather than by discipline — see below.

---

## Commands

```bash
pnpm db:up          # start a local Postgres 17 container (port 55499)
pnpm db:migrate     # apply pending migrations, each in one transaction
pnpm db:reset       # drop, recreate, re-migrate
pnpm db:down        # stop and remove the container

DATABASE_URL=postgres://postgres:verify@127.0.0.1:55499/snapapps pnpm test
pnpm typecheck
```

Tests **skip** without `DATABASE_URL`, so `pnpm test` at the repo root does not fail on a
machine with no Docker. Set it to actually exercise them.

Migrations are tracked in `_migrations`. There is no migration framework: the runner
(`scripts/db.mjs`) applies ordered `.sql` files once each, inside a transaction, and that is
all a hand-authored schema needs.

---

## The two test suites

### `test/drift.test.ts` — declarations match the database

Applies the real migrations, then compares **both directions**:

- every declared table exists;
- every declared column exists with a matching type (domains compared by `domain_name`,
  enums by `udt_name`);
- every column the database has is declared — this is the direction that catches a column
  added in SQL and forgotten in TS;
- no migrated table is left undeclared;
- all 11 enums exist with matching members, in order.

### `test/rls.test.ts` — tenant isolation

Runs on a single connection as the **real application roles**, because a superuser bypasses
RLS and would make every assertion pass vacuously. It proves:

- `app_rw` with tenant A sees only A's rows — and reads `100.0000`, not B's `500.0000`, so
  it is genuine isolation rather than an empty result;
- tenant B's rows stay hidden even when addressed by primary key;
- **RLS applies inside views.** A Postgres view runs as its owner unless `security_invoker`
  is set; without it `v_bas_lines` would happily return every tenant's GST. This assertion
  is the one that catches that regression;
- **fail closed** — no tenant context means no rows, not all rows;
- a cross-tenant write is rejected and nothing leaks;
- `audit_log` is append-only: INSERT works, UPDATE and DELETE are *revoked* (a policy alone
  would still permit a matching UPDATE);
- the worker can drain the whole `jobs` queue but reads no tenant data until it sets a
  tenant context;
- `app_readonly` can read but not write.

---

## Using it

```ts
import { createDb, createPool, withTenant, schema } from '@snap/db';

const db = createDb(createPool(process.env.DATABASE_URL!));

const docs = await withTenant(db, tenantId, async (tx) =>
  tx.select().from(schema.documents).limit(20),
);
```

### `withTenant` is not optional

Every RLS policy resolves `current_setting('app.tenant_id')`, and two things make this
helper mandatory rather than convenient:

1. **Pooling.** The setting must apply to the *same* connection that runs the query.
   Setting it outside a transaction hands the next borrower of that pooled connection
   someone else's tenant context — a cross-tenant leak that no single-connection test will
   ever reveal. A transaction pins the connection, and `is_local = true` discards the
   setting at COMMIT or ROLLBACK.
2. **`SET` takes no bind parameters.** `SET LOCAL app.tenant_id = $1` is not valid SQL, so
   the naive workaround is string interpolation — SQL injection on the one value that gates
   all tenant isolation. `set_config(name, value, is_local)` is an ordinary function and
   does accept a parameter, so the id is bound, never interpolated.

### Money is a string, deliberately

`money_amount` is `NUMERIC(19,4)` and the `pg` driver returns it as a string so precision
is never lost. The branded types in `src/types.ts` keep it that way: `parseFloat(amount)`
is a type error, not a rounding bug discovered at audit time. Use `src/money.ts` for
arithmetic — exact decimal maths on scaled `BigInt`, no dependency, no floats.

```ts
import { money } from '@snap/db';
money.balances([money.money('100.00'), money.money('10.00'), money.money('-110.00')]); // true
money.gstFromInclusive(money.money('110.00')); // "10.0000" — exactly 1/11
```

`money.balances` lets the UI say "these splits don't balance" *before* the database's
deferred trigger rejects the COMMIT. The trigger is the backstop, not the first line of
defence.

---

## Notes for whoever changes the schema next

1. **Add a new numbered `.sql` file.** Never edit an applied migration.
2. **Mirror the change in `src/schema/tables.ts`.** The drift test will fail until you do —
   that is its job.
3. **New tenant-scoped table?** Add it to the `tenant_tables` array in a new RLS migration.
   A table with RLS enabled and no policy denies everything, so a forgotten table fails
   loudly rather than leaking.
4. **New view?** Set `security_invoker = true` or it bypasses RLS entirely.
5. **Deleting fixtures?** `captures.tenant_id` is `ON DELETE RESTRICT` on purpose — a
   capture is the ATO legal record and must not vanish because a parent row went. Test
   teardown deletes children first; see `wipeFixtures` in `test/rls.test.ts`.
