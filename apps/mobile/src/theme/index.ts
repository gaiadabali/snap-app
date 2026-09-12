import { useColorScheme } from 'react-native';

import { palettes, type Palette } from './tokens';

export * from './tokens';

export function usePalette(): Palette {
  // `useColorScheme` returns null before the OS value resolves; light is the
  // safer default because the demo is most likely shown on a projector.
  return useColorScheme() === 'dark' ? palettes.dark : palettes.light;
}

/* Formatters live in src/lib/format.ts (pure, testable) and are re-exported
   here so screens can keep importing everything display-related from '@/theme'. */
export { formatAbn, formatAud, formatShortDate } from '@/lib/format';
