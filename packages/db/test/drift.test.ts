import { getTableConfig } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/schema';

/**
 * DRIFT TEST — the price of choosing SQL-as-source-of-truth.
 *
 * `drizzle-kit generate` is not the migration author here, because the schema
 * uses domains, plpgsql functions, deferrable constraint triggers, RLS policies
 * and security_invoker views that no ORM DSL expresses. The cost of that choice
 * is that the Drizzle declarations could silently drift from the SQL.
 *
 * So: apply the real migrations to a real Postgres, then compare every declared
 * table and column against `information_schema` — in both directions. A missing
 * column, a renamed column, a wrong type, or a table nobody declared all fail
 * the build instead of surfacing as a runtime error in production.
 *
 * Requires DATABASE_URL. `pnpm db:up && pnpm db:migrate` provides one.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

/** Drizzle SQL type -> the token Postgres reports (domain_name, else udt_name). */
const TYPE_MAP: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  'text[]': '_text',
  boolean: 'bool',
  integer: 'int4',
  bigint: 'int8',
  bigserial: 'int8',
  smallint: 'int2',
  jsonb: 'jsonb',
  date: 'date',
  'timestamp with time zone': 'timestamptz',
  bytea: 'bytea',
  citext: 'citext',
  inet: 'inet',
  // Postgres DOMAINs, reported via information_schema.domain_name
  money_amount: 'money_amount',
  unit_price: 'unit_price',
  quantity: 'quantity',
  tax_rate: 'tax_rate',
  currency_code: 'currency_code',
  country_code: 'country_code',
  confidence: 'confidence',
};

function normalise(drizzleType: string): string | null {
  const t = drizzleType.toLowerCase();
  if (TYPE_MAP[t]) return TYPE_MAP[t];
  // character(11) / char(4) -> bpchar
  if (/^(character|char)\s*\(\d+\)$/.test(t)) return 'bpchar';
  if (/^varchar(\(\d+\))?$/.test(t)) return 'varchar';
  // numeric(5, 4) -> 'numeric': information_schema.udt_name drops precision
  // and scale (they live in numeric_precision/numeric_scale instead), which
  // this query doesn't select, so only the base type name is compared.
  if (/^numeric\(\d+,\s*\d+\)$/.test(t)) return 'numeric';
  // Enums arrive as their own type name and match udt_name directly.
  if (/^[a-z_][a-z0-9_]*$/.test(t)) return t;
  return null;
}

type DbColumn = { table: string; column: string; type: string; nullable: boolean };

/** Migration bookkeeping, owned by scripts/db.mjs — not part of the schema. */
const NOT_SCHEMA = new Set(['_migrations']);

describeIfDb('schema drift: Drizzle declarations vs migrated database', () => {
  let pool: Pool;
  let dbColumns: DbColumn[];
  let dbTables: Set<string>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const res = await pool.query<{
      table_name: string;
      column_name: string;
      type_name: string;
      is_nullable: string;
    }>(`
      SELECT c.table_name,
             c.column_name,
             COALESCE(c.domain_name, c.udt_name) AS type_name,
             c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name  = c.table_name
       AND t.table_type  = 'BASE TABLE'
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position
    `);
    dbColumns = res.rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      type: r.type_name,
      nullable: r.is_nullable === 'YES',
    }));
    dbTables = new Set(dbColumns.map((c) => c.table));
  });

  afterAll(async () => {
    await pool?.end();
  });

  const declared = Object.entries(schema)
    .filter(([, v]) => {
      try {
        getTableConfig(v as never);
        return true;
      } catch {
        return false; // enums and other exports
      }
    })
    .map(([key, v]) => ({ key, config: getTableConfig(v as never) }));

  it('finds tables to compare', () => {
    expect(declared.length).toBeGreaterThan(20);
  });

  it('migrations created every declared table', () => {
    const missing = declared.map((d) => d.config.name).filter((n) => !dbTables.has(n));
    expect(missing, `declared in TS but absent from the database: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  describe.each(declared.map((d) => [d.config.name, d] as const))('%s', (_name, d) => {
    it('every declared column exists with a matching type', () => {
      const actual = new Map(
        dbColumns.filter((c) => c.table === d.config.name).map((c) => [c.column, c]),
      );

      const problems: string[] = [];
      for (const col of d.config.columns) {
        const got = actual.get(col.name);
        if (!got) {
          problems.push(`missing column "${col.name}"`);
          continue;
        }
        const want = normalise(col.getSQLType());
        if (want && want !== got.type) {
          problems.push(`"${col.name}": declared ${col.getSQLType()} (=${want}), db has ${got.type}`);
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });

    it('declares every column the database actually has', () => {
      const declaredNames = new Set(d.config.columns.map((c) => c.name));
      const undeclared = dbColumns
        .filter((c) => c.table === d.config.name && !declaredNames.has(c.column))
        .map((c) => `${c.column} (${c.type})`);
      expect(
        undeclared,
        `present in the database but not declared in TS: ${undeclared.join(', ')}`,
      ).toEqual([]);
    });
  });

  it('leaves no migrated table undeclared', () => {
    const declaredTables = new Set(declared.map((d) => d.config.name));
    const undeclared = [...dbTables].filter(
      (t) => !declaredTables.has(t) && !NOT_SCHEMA.has(t),
    );
    expect(
      undeclared,
      `tables exist in the database with no Drizzle declaration: ${undeclared.join(', ')}`,
    ).toEqual([]);
  });

  it('declares every enum with matching members', async () => {
    const res = await pool.query<{ enum_name: string; members: string[] }>(`
      -- enumlabel has type "name", and node-postgres has no parser for name[];
      -- the ::text cast makes it text[], which it does parse into a JS array.
      SELECT t.typname AS enum_name,
             array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS members
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname
    `);
    const dbEnums = new Map(res.rows.map((r) => [r.enum_name, r.members]));

    // pgEnum returns a *callable* carrying .enumName/.enumValues, so a
    // `typeof v === 'object'` guard silently matches nothing.
    const tsEnums = (Object.values(schema) as unknown[])
      .filter((v): v is { enumName: string; enumValues: readonly string[] } => {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
        const c = v as { enumName?: unknown; enumValues?: unknown };
        return typeof c.enumName === 'string' && Array.isArray(c.enumValues);
      })
      .map((v) => [v.enumName, [...v.enumValues]] as const);

    expect(tsEnums.length).toBeGreaterThan(5);
    for (const [name, members] of tsEnums) {
      expect(dbEnums.has(name), `enum ${name} missing from database`).toBe(true);
      expect(dbEnums.get(name), `enum ${name} members differ`).toEqual(members);
    }
  });
});
