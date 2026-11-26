import { defineConfig } from 'vitest/config';

// Pure TypeScript, no DOM: the engine is tested in Node with a fake fetch, a fake
// JMAP proxy and react-dom/server (hooks' initial render). Tests live in test/, not
// src/, so the vendored copies of src/ in YourTal and FTR carry no test code.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
