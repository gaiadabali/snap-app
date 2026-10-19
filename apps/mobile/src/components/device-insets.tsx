import { createContext, useContext } from 'react';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * The device's real safe-area insets.
 *
 * Screens above the bottom bar are told the bottom inset is zero — the bar
 * (`components/BottomNav`) sits on the home indicator, so they never reach
 * it. A full-screen MODAL is the exception: it covers the bar as well and does
 * sit on the indicator, so a sheet reads its padding from here instead of from
 * `useSafeAreaInsets`.
 *
 * Its own module, not BottomNav's: the sheets that read it are imported by the
 * menu that BottomNav itself imports, and a cycle there is a load-order bug
 * waiting for the first refactor.
 */
export const DeviceInsets = createContext<EdgeInsets | null>(null);

export function useDeviceInsets(): EdgeInsets {
  const screen = useSafeAreaInsets();
  return useContext(DeviceInsets) ?? screen;
}
