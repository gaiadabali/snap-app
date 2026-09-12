-- ---------------------------------------------------------------------------
-- 0016 — an address has to look like an address
--
-- A user row with the email `not-an-email` is currently sitting in the
-- development database. It got there because validation was silently skipped on
-- every endpoint: esbuild does not implement `emitDecoratorMetadata`, so Nest
-- saw no metatype for the DTO and ran no validator. That is fixed in the
-- application (`ValidBody`), and this is the layer that does not depend on a
-- transpiler flag being set correctly.
--
-- Deliberately loose. This is a shape check, not an attempt to implement
-- RFC 5322 in a regex — the only address that is truly valid is the one that
-- accepted a message. It rejects the things that are obviously not addresses:
-- no `@`, nothing before or after it, whitespace, no dot in the domain.
--
-- NOT VALID, so it applies to every insert and update from now on but does not
-- verify rows that already exist. A migration that refuses to apply because of
-- historical data leaves a deployment stuck, and a migration that deletes the
-- offending rows to get past that is far worse: it silently removes accounts.
-- Existing rows are a data-cleanup task, not a schema one.
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_shape;
ALTER TABLE users
  ADD CONSTRAINT users_email_shape
  CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  NOT VALID;

COMMENT ON CONSTRAINT users_email_shape ON users IS
  'A shape check, not RFC 5322. The application validates too; this is the layer that still holds when the application does not.';
