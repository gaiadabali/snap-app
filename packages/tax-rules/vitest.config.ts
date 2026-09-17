import { defineConfig } from 'vitest/config';

/* Minimal on purpose, matching @snap/tax-engine: this package imports nothing
   but relative paths and `vitest`. If this file ever needs an alias or a
   plugin, something has leaked into the engine. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
