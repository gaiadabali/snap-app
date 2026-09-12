import { defineConfig } from 'vitest/config';

/* Deliberately minimal. The host app's vitest config carries a React plugin, an
   `@/*` path alias and a `server-only` stub; the engine needs none of them
   because it imports nothing but relative paths and `vitest`. If this file ever
   needs an alias or a plugin, something has leaked into the engine.

   `smoke/` is included alongside `src/`: it imports the package by name rather
   than by relative path, so it is the only thing here that would catch a broken
   workspace link or `exports` map. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'smoke/**/*.test.ts'],
    environment: 'node',
  },
});
