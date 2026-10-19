import { Tabs } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { Sidebar } from '@/components/Sidebar';
import { control, usePalette } from '@/theme';

/**
 * Five tabs: Home, Budgets, Scan, Profile, Menu.
 *
 * Widened from three in the 2026-09-19 redesign. Budgets and Profile were the
 * two destinations people were reaching through the menu most often, and a
 * menu hop is a poor price for the screen that answers "how much is left".
 *
 * Menu still does not navigate — its press is intercepted and opens the
 * sidebar over the current screen instead, so the menu stays a glance rather
 * than a destination and the tab bar remains usable underneath it.
 */
function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={23} color={color} />;
  };
}

export default function TabsLayout() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: p.accent,
          tabBarInactiveTintColor: p.inkMuted,
          tabBarStyle: {
            backgroundColor: p.ground,
            borderTopColor: p.rule,
            borderTopWidth: StyleSheet.hairlineWidth * 2,
            height: control.tabItem + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
          tabBarItemStyle: { paddingVertical: 0 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: tabIcon('wallet') }} />
        <Tabs.Screen name="capture" options={{ title: 'Scan', tabBarIcon: tabIcon('scan') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('user') }} />
        <Tabs.Screen
          name="menu"
          options={{ title: 'Menu', tabBarIcon: tabIcon('menu') }}
          listeners={{
            // Open the sidebar instead of navigating. Without preventDefault the
            // router would also push the fallback screen underneath the panel.
            tabPress: (e) => {
              e.preventDefault();
              setMenuOpen(true);
            },
          }}
        />
      </Tabs>

      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
