import { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { tick } from '@/components/motion';
import { Sidebar } from '@/components/Sidebar';
import { control, onVoid, radius, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

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
 *
 * The bar itself is drawn here rather than by the navigator (instrument pass,
 * 2026-10-19), for three things the stock bar cannot do: Scan as a key of its
 * own rather than a fifth equal icon, an indicator that travels between tabs
 * instead of a whole icon turning blue, and a bar that goes dark when the
 * camera is up, so the viewfinder runs to the bottom edge instead of stopping
 * at a pale strip.
 */
const ICONS: Record<string, IconName> = {
  index: 'home',
  budgets: 'wallet',
  capture: 'scan',
  profile: 'user',
  menu: 'menu',
};

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

function TabBar({ state, descriptors, navigation }: BarProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const current = state.routes[state.index]?.name;
  const onCamera = current === 'capture';

  // The indicator: a short accent hairline riding the top edge of the bar.
  const x = useSharedValue(-100);
  const itemW = width / Math.max(state.routes.length, 1);
  useEffect(() => {
    if (!width) return;
    x.value = withTiming(state.index * itemW + itemW / 2 - 12, {
      duration: 260,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      reduceMotion: ReduceMotion.System,
    });
  }, [state.index, itemW, width, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const bg = onCamera ? '#07090C' : p.ground;
  const edge = onCamera ? 'rgba(255,255,255,0.08)' : p.rule;
  const on = onCamera ? '#FFFFFF' : p.ink;
  const off = onCamera ? 'rgba(255,255,255,0.5)' : p.inkMuted;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        backgroundColor: bg,
        borderTopWidth: 1,
        borderTopColor: edge,
        paddingBottom: insets.bottom,
        height: control.tabItem + insets.bottom,
      }}
    >
      {!onCamera ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: -1, left: 0, width: 24, height: 2, backgroundColor: p.accent },
            indicator,
          ]}
        />
      ) : null}

      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const { options } = descriptors[route.key]!;
        const label = typeof options.title === 'string' ? options.title : route.name;
        const scan = route.name === 'capture';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            tick();
            navigation.navigate(route.name, route.params);
          } else if (event.defaultPrevented) {
            // Menu: its listener opened the sidebar instead.
            tick();
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {scan ? (
              /* Scan is a key, not a tab icon: the app exists to do this one
                 thing, so it gets the one filled control in the bar. Ink on
                 light, white on the camera — it inverts against whatever it
                 sits on rather than borrowing the brand blue. */
              <View
                style={{
                  width: 46,
                  height: 30,
                  borderRadius: radius.md,
                  backgroundColor: onCamera ? onVoid.scan : p.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="scan" size={19} color={onCamera ? '#06141A' : p.ground} />
              </View>
            ) : (
              <Icon name={ICONS[route.name] ?? 'home'} size={22} color={focused ? on : off} />
            )}
            <Text
              style={[type.tab, { color: focused ? on : off }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="budgets" options={{ title: 'Budgets' }} />
        <Tabs.Screen name="capture" options={{ title: 'Scan' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
        <Tabs.Screen
          name="menu"
          options={{ title: 'Menu' }}
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
