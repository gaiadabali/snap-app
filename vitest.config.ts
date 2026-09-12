import { defineConfig } from 'vitest/config';

// Root-level suite: workspace boundary rules only. Package suites run via
// `pnpm -r test` (see the root "test" script).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
