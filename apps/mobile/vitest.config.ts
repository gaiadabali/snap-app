import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Two kinds of test.
 *
 * Pure logic (`src/lib`, `src/api`, `src/fixtures`): the arithmetic, where a
 * one-cent error is a real defect and a unit test is the right tool.
 *
 * Component renders (`src/components`, `*.test.tsx`): a presentational
 * component rendered to static markup through react-native-web, so every state
 * and message of a screen is checked from props alone. This is NOT a stand-in
 * for driving the built app (gestures, navigation, fonts, the keyboard); it
 * proves what each state SAYS. Only components that take their data as props
 * are tested this way; screens that fetch are still verified by driving the app.
 * Five modules are aliased because Node cannot load them: react-native (to
 * its web build), the Geist font loader, AsyncStorage, react-native-svg and
 * react-native-safe-area-context (both reach into Flow-typed react-native
 * internals).
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: '@/theme/text', replacement: path.resolve(import.meta.dirname, 'src/test/text-stub.tsx') },
      { find: 'react-native-svg', replacement: path.resolve(import.meta.dirname, 'src/test/svg-stub.tsx') },
      {
        find: 'react-native-safe-area-context',
        replacement: path.resolve(import.meta.dirname, 'src/test/safe-area-stub.ts'),
      },
      {
        find: '@react-native-async-storage/async-storage',
        replacement: path.resolve(import.meta.dirname, 'src/test/async-storage-stub.ts'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  test: {
    // The fixture is included as well as the libraries: it is generated
    // arithmetic that every screen depends on, so it is checked, not trusted.
    include: [
      'build-version.test.ts',
      'src/lib/**/*.test.ts',
      'src/fixtures/**/*.test.ts',
      'src/api/**/*.test.ts',
      'src/components/**/*.test.tsx',
    ],
    environment: 'node',
    server: { deps: { inline: [/react-native/, /expo-/] } },
  },
});
