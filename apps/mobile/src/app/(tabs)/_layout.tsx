import { Tabs } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sidebar } from '@/components/Sidebar';
import { usePalette } from '@/theme';

/**
 * Three tabs: Home, Scan, Menu.
 *
 * Home and Scan navigate. Menu does not — its press is intercepted and opens a
 * sidebar over the current screen instead, so the menu is a glance rather than
 * a destination and the tab bar stays usable underneath it.
 */
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color, lineHeight: 22 }}>{glyph}</Text>;
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
          tabBarInactiveTintColor: p.inkFaint,
          tabBarStyle: {
            backgroundColor: p.ground,
            borderTopColor: p.rule,
            borderTopWidth: StyleSheet.hairlineWidth * 2,
            height: 56 + insets.bottom,
            paddingBottom: insets.bottom,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <TabGlyph glyph="⌂" color={color} />,
          }}
        />
        <Tabs.Screen
          name="capture"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color }) => <TabGlyph glyph="⬡" color={color} />,
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: 'Menu',
            tabBarIcon: ({ color }) => <TabGlyph glyph="☰" color={color} />,
          }}
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
