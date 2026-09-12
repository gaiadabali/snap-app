import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Pure-logic tests only.
 *
 * Screens need a React Native runtime and are verified by driving the built app
 * in a browser engine instead. What lives here is the arithmetic — where a
 * one-cent error is a real defect and a unit test is the right tool.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    // The fixture is included as well as the libraries: it is generated
    // arithmetic that every screen depends on, so it is checked, not trusted.
    include: ['src/lib/**/*.test.ts', 'src/fixtures/**/*.test.ts', 'src/api/**/*.test.ts'],
    environment: 'node',
  },
});
