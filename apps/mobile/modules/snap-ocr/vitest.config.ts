import { defineConfig } from 'vitest/config';

/**
 * Pure-logic tests for `snap-ocr`'s JS/TS side, run separately from
 * `apps/mobile`'s own `vitest.config.ts` (which only looks at
 * `src/lib`, `src/fixtures`, `src/api` — this module lives outside that
 * tree, and `apps/mobile/vitest.config.ts` is outside this ticket's file
 * ownership).
 *
 * Covers the OD-14 (`docs/ON-DEVICE.md` §11 Stage 3) arithmetic that can be
 * checked without a device, a native module, or `onnxruntime-react-native`:
 * the coordinate mapping in `src/ppocr/geometry.ts`. Everything that DOES
 * need those three lives in `src/ppocr/recognise.ts` and is explicitly
 * unverified — see its doc comment.
 *
 * Run with: `pnpm --filter @snap/mobile exec vitest run --config
 * modules/snap-ocr/vitest.config.ts`
 */
export default defineConfig({
  // Explicit, rather than relying on `--config`'s directory to imply it:
  // running this from `apps/mobile` (e.g. `pnpm --filter @snap/mobile
  // exec vitest run --config modules/snap-ocr/vitest.config.ts`) otherwise
  // resolves `include` against `process.cwd()`, which would ALSO match
  // `apps/mobile/src/**/*.test.ts` — a real failure mode hit while writing
  // this file: it silently ran the whole app's suite alongside this one.
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
