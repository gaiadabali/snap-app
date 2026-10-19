import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { useFonts } from 'expo-font';
import { createContext, forwardRef, useContext, useMemo, type ComponentRef } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

/**
 * Text and TextInput, set in Geist.
 *
 * The typeface is the premium pass's one deliberate move away from the
 * prototype's system fonts (2026-10-19): a crisp, technical grotesque with
 * true tabular figures, so a column of amounts lines up and the app has a
 * voice of its own rather than the phone's default.
 *
 * WHY A WRAPPER. On React Native a custom face is one file per weight,
 * registered under its own name — `Geist_600SemiBold`, not "Geist at 600".
 * `fontWeight` does not choose between those files: Android fakes a bold over
 * whatever face it has, iOS can fall back to the system font, and the web
 * build smears a faux bold over the regular cut. So every screen imports
 * `Text` from here, and this resolves the weight in the style to the one file
 * that was loaded. Screens keep writing `fontWeight: '700'`.
 *
 * Nesting is honoured: a nested Text that says nothing about weight inherits
 * its parent's, through a context, exactly as React Native would by default.
 *
 * A family this file does not own (`'monospace'` on the receipt docket, a
 * vendor face) passes through untouched.
 */

type Weight = 400 | 500 | 600 | 700;

export const FONT_SOURCES = {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
};

const FACES: Record<Weight, string> = {
  400: 'Geist_400Regular',
  500: 'Geist_500Medium',
  600: 'Geist_600SemiBold',
  700: 'Geist_700Bold',
};

/** The logical family name the type tokens use. */
export const SANS = 'Geist';

/**
 * Set once, before the first screen renders — the root layout holds the
 * splash until loading settles either way — so no Text renders against a
 * stale answer.
 */
let facesLoaded = false;

/**
 * Loads the faces and reports when the app may render. `ready` is true on
 * failure too: a typeface is not a reason to keep someone out of their
 * receipts, and on failure the resolver hands back the system font.
 */
export function useAppFonts(): { ready: boolean } {
  const [loaded, error] = useFonts(FONT_SOURCES);
  if (loaded) facesLoaded = true;
  return { ready: loaded || !!error };
}

function weightOf(w: TextStyle['fontWeight']): Weight | undefined {
  if (w === undefined || w === null) return undefined;
  if (w === 'normal') return 400;
  if (w === 'bold') return 700;
  const n = typeof w === 'number' ? w : Number.parseInt(w, 10);
  if (Number.isNaN(n)) return undefined;
  if (n < 500) return 400;
  if (n < 600) return 500;
  if (n < 700) return 600;
  return 700;
}

const WeightContext = createContext<Weight>(400);

/** Returns null for a family this file does not own. */
function resolve(style: TextProps['style'], parent: Weight): Weight | null {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily !== undefined && flat.fontFamily !== SANS) return null;
  return weightOf(flat.fontWeight) ?? parent;
}

function faceStyle(w: Weight): TextStyle {
  if (!facesLoaded) return { fontWeight: String(w) as TextStyle['fontWeight'] };
  // 'normal', not the weight: each bundled face is registered as its own
  // regular-weight family, so any other weight would be synthesised over it.
  return { fontFamily: FACES[w], fontWeight: 'normal' };
}

export const Text = forwardRef<ComponentRef<typeof RNText>, TextProps>(function Text(props, ref) {
  const parent = useContext(WeightContext);
  const w = resolve(props.style, parent);
  const value = useMemo(() => w ?? parent, [w, parent]);
  if (w === null) return <RNText ref={ref} {...props} />;
  return (
    <WeightContext.Provider value={value}>
      <RNText ref={ref} {...props} style={[props.style, faceStyle(w)]} />
    </WeightContext.Provider>
  );
});

export const TextInput = forwardRef<ComponentRef<typeof RNTextInput>, TextInputProps>(
  function TextInput(props, ref) {
    const w = resolve(props.style, 400);
    if (w === null) return <RNTextInput ref={ref} {...props} />;
    return <RNTextInput ref={ref} {...props} style={[props.style, faceStyle(w)]} />;
  },
);

/** The loaded face for a weight, for places that take a family as a plain
 *  string: `react-native-svg` text and the navigator's header title. */
export function face(weight: Weight = 400): string | undefined {
  return facesLoaded ? FACES[weight] : undefined;
}
