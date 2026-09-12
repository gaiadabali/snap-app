/**
 * Fail closed when the database suites would silently skip.
 *
 * Every suite here is written as `DATABASE_URL ? describe : describe.skip`, so
 * with no database they report "197 skipped" and the run is GREEN. That is the
 * shape of a disaster: the tenant-isolation policies, the admin plane's
 * capability refusals and the RLS proofs would all stop running, and nothing
 * would say so. It has already fooled a person on this project once.
 *
 * Locally, skipping is the right default — not everyone has Postgres up. In CI
 * it must be an error, so CI sets `REQUIRE_DB=1` and this refuses to start.
 */
export default function setup(): void {
  if (process.env.REQUIRE_DB === '1' && !process.env.DATABASE_URL) {
    throw new Error(
      'REQUIRE_DB=1 but DATABASE_URL is unset. These suites would skip and report a green run ' +
        'while proving nothing — including every tenant-isolation and admin-capability refusal. ' +
        'See docs/WEB.md §8 for the full environment.',
    );
  }
}
