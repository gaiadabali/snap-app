import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeviceInsets } from '@/components/device-insets';

import { Icon, type IconName } from '@/components/Icon';
import { Sidebar } from '@/components/Sidebar';
import { heroGradient, usePalette, useTheme } from '@/theme';

/**
 * The bottom navigation — on every screen, not just the four tab roots.
 *
 * Asked for by the owner on 2026-10-19: "this menu need to be more like proper
 * phone app, with the middle menu more prominent … and ensure the bottom nav
 * always in every pages". The reference was the family of floating tab bars
 * modern apps use — a detached rounded bar, a pill behind the active tab, and
 * a raised round action in the middle.
 *
 * WHY IT LIVES IN THE ROOT LAYOUT. The tab navigator only draws its bar on
 * its own four screens; everything else (Spending, Credits, a receipt) is
 * pushed on the root stack above it and used to hide the bar entirely, so the
 * only way home from three screens deep was the back arrow three times. This
 * bar sits under the whole stack instead, so it is there on every page, and a
 * tap on it unwinds the stack to the tab it names.
 *
 * WHY SCAN IS THE RAISED BUTTON. Scanning is what the app is for, and the
 * credits it spends are the business model; it earns the one control in the
 * bar that is bigger, raised and in the brand gradient.
 */

type Tab = { key: string; label: string; icon: IconName; href: Href };

const LEFT: Tab[] = [
  { key: '/', label: 'Home', icon: 'home', href: '/' },
  { key: '/budgets', label: 'Budgets', icon: 'wallet', href: '/budgets' },
];
const RIGHT: Tab[] = [{ key: '/profile', label: 'Profile', icon: 'user', href: '/profile' }];

/** Height of the bar itself, excluding the safe area under it. */
export const BOTTOM_NAV_HEIGHT = 64;
const FAB = 54;
const RING = 4;
/** How far the raised button stands above the bar. The container reserves
 *  exactly this much above the bar, because a touch outside a parent's bounds
 *  never reaches its child on Android: the button is the container's child,
 *  not the bar's, so all of it — including the part above the bar — is
 *  inside a parent that receives the tap. */
const RISE = 25;

function tick(kind: 'select' | 'impact') {
  if (Platform.OS === 'web') return;
  void (kind === 'select'
    ? Haptics.selectionAsync()
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  ).catch(() => {});
}

export function BottomNav() {
  const p = usePalette();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Over the viewfinder the bar goes dark, so the camera does not end at a
  // bright strip. Everywhere else it follows the theme.
  const onCamera = pathname === '/capture';
  const dark = onCamera || scheme === 'dark';

  const go = (href: Href) => {
    tick('select');
    // Unwind anything pushed over the tabs first, then switch tab. Without the
    // dismiss, "Home" from a receipt would push a second Home on top of it.
    if (router.canDismiss()) router.dismissAll();
    router.navigate(href);
  };

  const barBg = onCamera ? 'rgba(24,26,30,0.96)' : scheme === 'dark' ? p.surface : '#FFFFFF';

  return (
    <>
      <View
        style={{
          backgroundColor: onCamera ? '#000' : p.ground,
          paddingHorizontal: 14,
          paddingTop: RISE,
          paddingBottom: Math.max(insets.bottom, 10),
        }}
      >
        <View
          style={[
            styles.bar,
            {
              backgroundColor: barBg,
              borderColor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,30,49,0.06)',
              shadowOpacity: dark ? 0 : 0.1,
            },
          ]}
        >
          {LEFT.map((t) => (
            <TabButton
              key={t.key}
              tab={t}
              active={pathname === t.key}
              dark={dark}
              onPress={() => go(t.href)}
            />
          ))}

          {/* The slot under the raised button keeps the row's rhythm and
              carries the caption, so Scan reads as one of the five. */}
          <View style={styles.fabSlot} pointerEvents="box-none">
            <Text
              style={[
                styles.label,
                { color: onCamera ? '#FFFFFF' : dark ? 'rgba(255,255,255,0.62)' : p.inkMuted },
              ]}
            >
              Scan
            </Text>
          </View>

          {RIGHT.map((t) => (
            <TabButton
              key={t.key}
              tab={t}
              active={pathname === t.key}
              dark={dark}
              onPress={() => go(t.href)}
            />
          ))}

          {/* Menu opens the sheet over whatever is on screen rather than
              navigating, so it stays a glance, not a destination. */}
          <TabButton
            tab={{ key: 'menu', label: 'Menu', icon: 'menu', href: '/' }}
            active={menuOpen}
            dark={dark}
            onPress={() => {
              tick('select');
              setMenuOpen(true);
            }}
          />
        </View>

        <View style={styles.fabLayer} pointerEvents="box-none">
          <ScanButton
            active={onCamera}
            ring={onCamera ? '#000' : p.ground}
            onPress={() => go('/capture')}
          />
        </View>
      </View>

      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

function TabButton({
  tab,
  active,
  dark,
  onPress,
}: {
  tab: Tab;
  active: boolean;
  dark: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  // The pill behind the active icon grows in rather than snapping, so a tap
  // is acknowledged on the bar itself before the screen changes.
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, { duration: 220, reduceMotion: ReduceMotion.System });
  }, [active, on]);
  const pill = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scaleX: 0.6 + on.value * 0.4 }],
  }));

  const activeFg = dark ? '#FFFFFF' : p.accent;
  const idleFg = dark ? 'rgba(255,255,255,0.62)' : p.inkMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          style={[
            styles.pill,
            { backgroundColor: dark ? 'rgba(255,255,255,0.14)' : p.accentSoft },
            pill,
          ]}
        />
        <Icon name={tab.icon} size={22} color={active ? activeFg : idleFg} />
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, { color: active ? activeFg : idleFg, fontWeight: active ? '700' : '600' }]}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

function ScanButton({
  active,
  ring,
  onPress,
}: {
  active: boolean;
  ring: string;
  onPress: () => void;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Scan a receipt"
      accessibilityState={{ selected: active }}
      onPressIn={() => {
        s.value = withTiming(0.92, { duration: 90, reduceMotion: ReduceMotion.System });
      }}
      onPressOut={() => {
        s.value = withSpring(1, { damping: 12, stiffness: 260, reduceMotion: ReduceMotion.System });
      }}
      onPress={() => {
        tick('impact');
        onPress();
      }}
      hitSlop={4}
    >
      <Animated.View style={[styles.fabRing, { backgroundColor: ring }, a]}>
        <LinearGradient
          colors={[...heroGradient.colors]}
          locations={[...heroGradient.locations]}
          start={heroGradient.start}
          end={heroGradient.end}
          style={[styles.fab, active && styles.fabActive]}
        >
          <Icon name="scan" size={26} color="#FFFFFF" />
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: BOTTOM_NAV_HEIGHT,
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    shadowColor: '#0F1E31',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 52,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 15,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  fabSlot: {
    width: 76,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 9,
  },
  fabLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fabRing: {
    width: FAB + RING * 2,
    height: FAB + RING * 2,
    borderRadius: (FAB + RING * 2) / 2,
    padding: RING,
  },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F5BB5',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabActive: {
    borderWidth: 2,
    borderColor: '#3FC6EE',
  },
});

/* ── The frame every signed-in screen sits in ─────────────────────────────── */

/**
 * The screens, then the bar under them. A column rather than an overlay, so
 * no screen's last row can ever end up hidden behind the bar — the thirty
 * screens that pad by `insets.bottom` keep working untouched, because inside
 * this frame that inset is zero.
 */
export function NavFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <DeviceInsets.Provider value={insets}>
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      <BottomNav />
    </DeviceInsets.Provider>
  );
}
