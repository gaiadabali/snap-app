import { Archivo_300Light } from '@expo-google-fonts/archivo/300Light';
import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { useFonts } from 'expo-font';
import { createContext, forwardRef, useContext, useMemo, type ComponentRef } from 'react';
import {
  Platform,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { font } from './tokens';

/**
 * Text and TextInput, with the type families resolved.
 *
 * On React Native a custom typeface is one file per weight, registered under
 * its own name — `Archivo_500Medium`, not "Archivo at 500". `fontWeight` does
 * not choose between those files: Android synthesises a fake bold over
 * whatever face it has, iOS may give up and use the system font, and the web
 * build smears a faux bold across the regular cut. So every screen imports
 * `Text` from here, not from 'react-native', and this resolves the logical
 * family in the style (`font.sans` / `font.mono`, or nothing) plus the weight
 * to the one face that was actually loaded.
 *
 * Nesting is honoured. `<Text style={bold}>Due <Text style={{color}}>today
 * </Text></Text>` must keep the inner span bold, which on React Native it
 * would by inheritance — but this component sets an explicit face on every
 * Text, which would break that. So the resolved family and weight travel down
 * a context, and a nested Text that says nothing about its type inherits them.
 *
 * Any family this file does not know (`'monospace'`, a vendor face) passes
 * through untouched with its weight, so nothing that opted out is overridden.
 */

type Role = 'sans' | 'mono';
type Weight = 300 | 400 | 500 | 600;

/** The faces bundled with the app. Archivo 700 is deliberately absent — see
 *  `type` in tokens.ts: SemiBold is the heaviest this app sets. */
export const FONT_SOURCES = {
  Archivo_300Light,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
};

const FACES: Record<Role, Record<Weight, string>> = {
  sans: {
    300: 'Archivo_300Light',
    400: 'Archivo_400Regular',
    500: 'Archivo_500Medium',
    600: 'Archivo_600SemiBold',
  },
  mono: {
    300: 'IBMPlexMono_400Regular',
    400: 'IBMPlexMono_400Regular',
    500: 'IBMPlexMono_500Medium',
    600: 'IBMPlexMono_500Medium',
  },
};

/** What a role falls back to if the bundled faces never loaded. */
const SYSTEM: Record<Role, string | undefined> = {
  sans: undefined,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }),
};

/**
 * Set once by `useAppFonts` before the first screen renders, never after — the
 * root layout holds the splash until the load settles either way, so no Text
 * ever renders against a stale answer.
 */
let facesLoaded = false;

/**
 * Loads the faces and reports when the app may render.
 *
 * `ready` is true on success AND on failure: a font that cannot load is not a
 * reason to keep someone out of their receipts. On failure the resolver below
 * hands back system faces and the app looks as it did before this pass.
 */
export function useAppFonts(): { ready: boolean } {
  const [loaded, error] = useFonts(FONT_SOURCES);
  if (loaded) facesLoaded = true;
  return { ready: loaded || !!error };
}

function roleOf(family: TextStyle['fontFamily']): Role | null | undefined {
  if (family === undefined) return undefined;
  if (family === font.sans) return 'sans';
  if (family === font.mono) return 'mono';
  return null;
}

function weightOf(w: TextStyle['fontWeight']): Weight | undefined {
  if (w === undefined || w === null) return undefined;
  if (w === 'normal') return 400;
  if (w === 'bold') return 600;
  const n = typeof w === 'number' ? w : Number.parseInt(w, 10);
  if (Number.isNaN(n)) return undefined;
  if (n <= 300) return 300;
  if (n < 500) return 400;
  if (n < 600) return 500;
  return 600;
}

type Resolved = { role: Role; weight: Weight };

const TypeContext = createContext<Resolved>({ role: 'sans', weight: 400 });

/** The face for a resolved role and weight, as a style to append last. */
function faceStyle(r: Resolved): TextStyle {
  if (!facesLoaded) {
    const sys = SYSTEM[r.role];
    return { fontFamily: sys, fontWeight: String(r.weight) as TextStyle['fontWeight'] };
  }
  // 'normal', not undefined: every bundled face is registered as a single
  // regular-weight family, so any other weight would be synthesised over it.
  return { fontFamily: FACES[r.role][r.weight], fontWeight: 'normal' };
}

function resolve(style: TextProps['style'], parent: Resolved): Resolved | null {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const role = roleOf(flat.fontFamily);
  if (role === null) return null; // a family we do not own — leave it alone
  return {
    role: role ?? parent.role,
    weight: weightOf(flat.fontWeight) ?? (role ? 400 : parent.weight),
  };
}

export const Text = forwardRef<ComponentRef<typeof RNText>, TextProps>(function Text(props, ref) {
  const parent = useContext(TypeContext);
  const r = resolve(props.style, parent);
  const role = r?.role;
  const weight = r?.weight;
  const value = useMemo<Resolved>(
    () => (role && weight ? { role, weight } : parent),
    [role, weight, parent],
  );
  if (!r) return <RNText ref={ref} {...props} />;
  return (
    <TypeContext.Provider value={value}>
      <RNText ref={ref} {...props} style={[props.style, faceStyle(r)]} />
    </TypeContext.Provider>
  );
});

export const TextInput = forwardRef<ComponentRef<typeof RNTextInput>, TextInputProps>(
  function TextInput(props, ref) {
    const r = resolve(props.style, { role: 'sans', weight: 400 });
    if (!r) return <RNTextInput ref={ref} {...props} />;
    return <RNTextInput ref={ref} {...props} style={[props.style, faceStyle(r)]} />;
  },
);

/** The resolved face for a role and weight — for the few places that take a
 *  font family as a plain string, such as `react-native-svg` text and the
 *  navigator's header title. */
export function face(role: Role, weight: Weight = 400): string | undefined {
  return facesLoaded ? FACES[role][weight] : SYSTEM[role];
}
