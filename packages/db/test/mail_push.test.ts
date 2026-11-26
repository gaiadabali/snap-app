import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * SPAMBANK MAIL ON SNAPAPP — migration 0060 (spambank/BUILD.md §4.9, §6).
 *
 * `push_tokens` and `mail_settings` are USER-scoped. This proves what the
 * header of 0060 promises, as the real application roles on one connection
 * (`SET ROLE` persists across statements; a superuser would bypass RLS and make
 * every isolation assertion pass vacuously — the reasoning of `rls.test.ts`):
 *
 *   - a person sees and deletes only their own tokens, and cannot insert or
 *     update one directly;
 *   - registering moves a token to its new holder, and keeps 10 per person;
 *   - only the worker can turn a YourTal `sub` into a user;
 *   - settings are self-scoped, and a erased workspace clears the choice.
 *
 * Requires DATABASE_URL as the schema owner (`pnpm db:up && pnpm db:migrate`).
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const TENANT = '0b0a1100-5b00-4000-8000-000000000001';
const USER = '0b0a1100-5b00-4000-8000-000000000002'; // signed in with YourTal
const OTHER = '0b0a1100-5b00-4000-8000-000000000003'; // not

const SUB = 'mail-push-sub-0060';
const token = (n: string) => `fcm-token-${n}-`.padEnd(40, 'x');

describeIfDb('mail push tokens and settings (migration 0060)', () => {
  let c: Client;

  async function as(role: 'app_rw' | 'app_worker', userId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  async function wipe() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false)`);
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query('DELETE FROM push_tokens WHERE user_id = ANY($1::uuid[])', [[USER, OTHER]]);
    await c.query('DELETE FROM mail_settings WHERE user_id = ANY($1::uuid[])', [[USER, OTHER]]);
    await c.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER]]);
  }

  const register = (t: string) => c.query('SELECT mail_push_token_register($1, $2)', [t, 'android']);
  const visible = async () =>
    (await c.query<{ token: string }>('SELECT token FROM push_tokens ORDER BY token')).rows.map((r) => r.token);

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1, $3, 'mail-push-user@mail-push.test', 'Mail Push User'),
              ($2, 'idp|mail-push-other', 'mail-push-other@mail-push.test', 'Other')`,
      [USER, OTHER, `yourtal|${SUB}`],
    );
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency) VALUES ($1, 'Mail push co', 'business', 'AU', 'AUD')`,
      [TENANT],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  describe('push_tokens', () => {
    it('registers a token for the caller, who alone can read it', async () => {
      await as('app_rw', USER);
      await register(token('a'));
      expect(await visible()).toEqual([token('a')]);

      await as('app_rw', OTHER);
      expect(await visible()).toEqual([]);
    });

    it('refuses a direct insert or update: registering goes through the function', async () => {
      await as('app_rw', USER);
      await expect(
        c.query(`INSERT INTO push_tokens (user_id, platform, token) VALUES ($1, 'android', $2)`, [USER, token('direct')]),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`UPDATE push_tokens SET platform = 'android' WHERE user_id = $1`, [USER])).rejects.toThrow(
        /permission denied/,
      );
    });

    it('moves a token to the next person who registers it, and takes it from the first', async () => {
      await as('app_rw', OTHER);
      await register(token('a'));
      expect(await visible()).toEqual([token('a')]);

      await as('app_rw', USER);
      expect(await visible()).toEqual([]);

      // And back, so the next tests start from USER holding it.
      await register(token('a'));
      expect(await visible()).toEqual([token('a')]);
    });

    it('refuses a bad token, a bad platform and a caller with no session', async () => {
      await as('app_rw', USER);
      await expect(c.query('SELECT mail_push_token_register($1, $2)', ['short', 'android'])).rejects.toThrow(
        /bad token or platform/,
      );
      await expect(c.query('SELECT mail_push_token_register($1, $2)', [token('ios'), 'ios'])).rejects.toThrow(
        /bad token or platform/,
      );
      await as('app_rw', null);
      await expect(register(token('nobody'))).rejects.toThrow(/no signed-in user/);
    });

    it('keeps the newest 10 tokens per person', async () => {
      await as('app_rw', USER);
      for (let i = 0; i < 12; i += 1) await register(token(`cap${String(i).padStart(2, '0')}`));
      const mine = await visible();
      expect(mine.length).toBe(10);
      // The oldest registrations went: `a`, `cap00` and `cap01`.
      expect(mine).not.toContain(token('a'));
      expect(mine).not.toContain(token('cap00'));
      expect(mine).toContain(token('cap11'));
    });

    it('lets a person delete their own tokens and no one else\'s', async () => {
      await as('app_rw', OTHER);
      await register(token('other'));
      await as('app_rw', USER);
      const gone = await c.query('DELETE FROM push_tokens WHERE token = $1', [token('other')]);
      expect(gone.rowCount).toBe(0);
      await as('app_rw', OTHER);
      expect(await visible()).toEqual([token('other')]);
      const own = await c.query('DELETE FROM push_tokens WHERE token = $1', [token('other')]);
      expect(own.rowCount).toBe(1);
    });
  });

  describe('the YourTal sub', () => {
    it('is the caller\'s own, from the session, and null for an account without one', async () => {
      await as('app_rw', USER);
      expect((await c.query<{ sub: string | null }>('SELECT mail_yourtal_sub() AS sub')).rows[0]?.sub).toBe(SUB);
      await as('app_rw', OTHER);
      expect((await c.query<{ sub: string | null }>('SELECT mail_yourtal_sub() AS sub')).rows[0]?.sub).toBeNull();
      await as('app_rw', null);
      expect((await c.query<{ sub: string | null }>('SELECT mail_yourtal_sub() AS sub')).rows[0]?.sub).toBeNull();
    });

    it('can be turned into a user by the worker only', async () => {
      await as('app_rw', USER);
      await expect(c.query('SELECT mail_push_user_for_sub($1)', [SUB])).rejects.toThrow(/permission denied/);

      await as('app_worker', null);
      const found = await c.query<{ id: string | null }>('SELECT mail_push_user_for_sub($1) AS id', [SUB]);
      expect(found.rows[0]?.id).toBe(USER);
      const none = await c.query<{ id: string | null }>('SELECT mail_push_user_for_sub($1) AS id', ['nobody-0060']);
      expect(none.rows[0]?.id).toBeNull();
    });

    it('lets the worker read and prune a person\'s tokens once it is acting as them', async () => {
      await as('app_worker', USER);
      const own = await visible();
      expect(own.length).toBeGreaterThan(0);
      const del = await c.query('DELETE FROM push_tokens WHERE token = $1', [own[0]]);
      expect(del.rowCount).toBe(1);
      await as('app_worker', null);
      expect(await visible()).toEqual([]);
    });
  });

  describe('mail_settings', () => {
    it('is the caller\'s own row, and a stranger sees and writes none of it', async () => {
      await as('app_rw', USER);
      await c.query('INSERT INTO mail_settings (user_id, import_tenant_id, alerts) VALUES ($1, $2, false)', [USER, TENANT]);
      const mine = await c.query<{ alerts: boolean; import_tenant_id: string }>(
        'SELECT alerts, import_tenant_id FROM mail_settings',
      );
      expect(mine.rows).toEqual([{ alerts: false, import_tenant_id: TENANT }]);

      await as('app_rw', OTHER);
      expect((await c.query('SELECT 1 FROM mail_settings')).rowCount).toBe(0);
      await expect(
        c.query('INSERT INTO mail_settings (user_id, alerts) VALUES ($1, true)', [USER]),
      ).rejects.toThrow(/row-level security/);
      const update = await c.query('UPDATE mail_settings SET alerts = true WHERE user_id = $1', [USER]);
      expect(update.rowCount).toBe(0);
    });

    it('cannot be deleted by the API, and loses its workspace when that is erased', async () => {
      await as('app_rw', USER);
      await expect(c.query('DELETE FROM mail_settings WHERE user_id = $1', [USER])).rejects.toThrow(/permission denied/);

      await c.query('RESET ROLE');
      await c.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
      const left = await c.query<{ import_tenant_id: string | null }>(
        'SELECT import_tenant_id FROM mail_settings WHERE user_id = $1',
        [USER],
      );
      expect(left.rows).toEqual([{ import_tenant_id: null }]);
    });
  });

  it('removes both rows with the person (erase_person deletes the user)', async () => {
    await as('app_rw', OTHER);
    await register(token('goner'));
    await c.query('RESET ROLE');
    await c.query('INSERT INTO mail_settings (user_id) VALUES ($1)', [OTHER]);
    await c.query('DELETE FROM users WHERE id = $1', [OTHER]);
    expect((await c.query('SELECT 1 FROM push_tokens WHERE user_id = $1', [OTHER])).rowCount).toBe(0);
    expect((await c.query('SELECT 1 FROM mail_settings WHERE user_id = $1', [OTHER])).rowCount).toBe(0);
  });
});
