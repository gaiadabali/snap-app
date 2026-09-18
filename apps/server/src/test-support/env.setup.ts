/**
 * Test-only environment, set once for every file in this suite.
 *
 * WHY THIS EXISTS. Ten test files here read `TOKEN_SECRET` transitively — via
 * `config()`, the session guard, or anything that builds a token — and none of
 * them set it. They passed anyway, because *some other file* in the same run
 * happened to set it first and `process.env` is global to the process.
 *
 * So `pnpm vitest run` was green and `pnpm vitest run src/transactions` was 45
 * failures, from identical code. Two separate agents hit it on the same day and
 * both reasonably concluded the tree was broken. CI never saw it because the
 * workflow exports `TOKEN_SECRET` for the whole job.
 *
 * That is the same shape as the rest of this codebase's expensive bugs: a thing
 * that was green for a reason unrelated to what it was meant to prove. Setting
 * it per-file with `??=` would have worked too, and would have left the
 * eleventh file to rediscover it.
 *
 * `??=` throughout: a real value in the environment always wins, so a run that
 * deliberately sets one of these is never overridden by the fallback.
 */

// Long enough to satisfy the config's own length check. Obviously not a secret,
// and deliberately says so, so it cannot be mistaken for one worth protecting.
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

// The admin KMS key is the same story: a fixed test value, never a real one.
process.env.ADMIN_KMS_MASTER_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
