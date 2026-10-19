import { Tabs } from 'expo-router';

/**
 * Four tab roots: Home, Budgets, Scan, Profile — plus Menu, kept as a route
 * only as a fallback target.
 *
 * Widened from three in the 2026-09-19 redesign. Budgets and Profile were the
 * two destinations people were reaching through the menu most often, and a
 * menu hop is a poor price for the screen that answers "how much is left".
 *
 * The navigator's own bar is switched off (2026-10-19). The bar you see is
 * `components/BottomNav`, drawn once in the root layout under every screen —
 * pushed screens included, which this navigator's bar could never reach. This
 * navigator still does the part it is good at: each tab keeps its own state
 * while you are on another. The Menu sheet opens from that bar too, over
 * whatever screen is showing.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={() => null}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets' }} />
      <Tabs.Screen name="capture" options={{ title: 'Scan' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
    </Tabs>
  );
}
