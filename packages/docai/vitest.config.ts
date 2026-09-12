import { defineConfig } from 'vitest/config';

// Minimal, matching @snap/tax-engine's config: this package is pure
// TypeScript plus pdfjs-dist (no DOM, no server-only stub needed), so it
// needs no plugins or aliases. Tests live next to the code they cover.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
