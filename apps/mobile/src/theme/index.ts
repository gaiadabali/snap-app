import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { palettes, type Palette, type Scheme } from './tokens';

export * from './tokens';

/**
 * How the app picks light or dark.
 *
 * It followed the OS and nothing else until 2026-09-19, when the redesign put
 * a sun/moon toggle in the home chrome. So there are now three states, not
 * two: `'system'` (the default, and what almost everyone stays on) plus an
 * explicit `'light'` or `'dark'` that overrides it.
 *
 * The choice is persisted. A theme that resets on every cold start is worse
 * than no toggle at all — the person taps it again, decides it did not work,
 * and stops trusting the control.
 */
export type ThemePreference = 'system' | Scheme;

const KEY = 'snap.theme';

type Ctx = {
  scheme: Scheme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Flips between light and dark, leaving `'system'` behind for good. */
  toggle: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const os = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(KEY)
      .then((v) => {
        if (live && (v === 'light' || v === 'dark' || v === 'system')) setPref(v);
      })
      .catch(() => {
        /* A theme is not worth failing a launch over. */
      });
    return () => {
      live = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPref(next);
    void AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  // `useColorScheme` returns null before the OS value resolves; light is the
  // safer default because the demo is most likely shown on a projector.
  const scheme: Scheme = preference === 'system' ? (os === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<Ctx>(
    () => ({
      scheme,
      preference,
      setPreference,
      toggle: () => setPreference(scheme === 'dark' ? 'light' : 'dark'),
    }),
    [scheme, preference, setPreference],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

/**
 * The scheme in force, and how to change it.
 *
 * Falls back to the OS when no provider is mounted, so a screen rendered in a
 * test or a Storybook-style harness still gets a real answer rather than
 * throwing.
 */
export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  const os = useColorScheme();
  const fallbackScheme: Scheme = os === 'dark' ? 'dark' : 'light';
  return (
    ctx ?? {
      scheme: fallbackScheme,
      preference: 'system',
      setPreference: () => {},
      toggle: () => {},
    }
  );
}

export function usePalette(): Palette {
  return palettes[useTheme().scheme];
}

/* Formatters live in src/lib/format.ts (pure, testable) and are re-exported
   here so screens can keep importing everything display-related from '@/theme'. */
export { formatAbn, formatAud, formatShortDate } from '@/lib/format';
