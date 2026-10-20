/** Stands in for react-native-safe-area-context under test: zero insets. */
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export type EdgeInsets = { top: number; right: number; bottom: number; left: number };
