import { defineConfig } from 'vitest/config';

// Minimal, matching @snap/docai-preview's config: this package is pure
// TypeScript with zero runtime dependencies, so it needs no plugins or
// aliases. Tests live next to the code they cover.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
