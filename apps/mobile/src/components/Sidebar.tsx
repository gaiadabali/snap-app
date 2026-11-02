import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type PersonalSummary, type SalesSummary } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { MenuContent } from '@/components/MenuContent';
import { Figure, IconButton, Small } from '@/components/ui';
import { space, usePalette } from '@/theme';
import { useMoney } from '@/lib/use-money';
import { useWorkspace } from '@/workspace';
import { useCallback, useState } from 'react';

/**
 * The menu, as a panel that slides in from the right.
 *
 * A drawer rather than a screen: the menu is somewhere you glance and leave,
 * not a destination. Sliding it over the current page keeps that context —
 * Home stays visible behind the scrim — and the bottom bar stays put underneath,
 * so Home and Scan are still one tap away without dismissing anything.
 *
 * Built on Animated rather than a navigation drawer library: the bottom bar has to
 * keep working while this is open, which a drawer navigator would take over.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const money = useMoney();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const width = Math.min(Dimensions.get('window').width * 0.86, 400);

  const slide = useRef(new Animated.Value(width)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  const { isBusiness } = useWorkspace();
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [personal, setPersonal] = useState<PersonalSummary | null>(null);

  const load = useCallback(() => {
    // Each workspace has exactly one figure worth putting above a menu:
    // business is owed money, personal has money left.
    if (isBusiness) void api().getSales().then(setSales);
    else void api().getPersonal().then(setPersonal);
  }, [isBusiness]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      load();
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slide, {
          toValue: width,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        // Unmount only after the slide-out, or the panel vanishes mid-animation.
        if (finished) setMounted(false);
      });
    }
  }, [open, slide, fade, width, load]);

  if (!mounted) return null;
  const overdue = Number(sales?.overdue ?? '0');
  const over = personal ? Number(personal.remaining) < 0 : false;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Scrim. Tapping anywhere off the panel closes it. */}
        <Animated.View style={{ flex: 1, opacity: fade }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={onClose}
            style={{ flex: 1, backgroundColor: p.overlay }}
          />
        </Animated.View>

        <Animated.View
          style={{
            width,
            backgroundColor: p.ground,
            transform: [{ translateX: slide }],
            borderLeftWidth: 1,
            borderLeftColor: p.rule,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 24,
            shadowOffset: { width: -8, height: 0 },
            elevation: 16,
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: insets.top + space.lg,
              paddingBottom: insets.bottom + space.xxl,
              paddingHorizontal: space.gutter,
              gap: space.xl,
            }}
          >
            {/* The close target is a full 44pt IconButton, nudged out so its
                glyph (not its box) lines up with the gutter. */}
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Figure size="h1">Menu</Figure>
              <IconButton
                name="close"
                label="Close"
                onPress={onClose}
                color={p.inkMuted}
                style={{ marginRight: -space.md }}
              />
            </View>

            {/* The one thing worth surfacing above a menu. */}
            {!isBusiness && personal ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  router.push('/budgets');
                }}
              >
                <GradientHero tone={over ? 'risk' : 'brand'}>
                  <View style={{ gap: space.xs }}>
                    <HeroLabel>{over ? 'Over budget' : 'Left this month'}</HeroLabel>
                    <HeroFigure small>{money.fmt(personal.remaining)}</HeroFigure>
                    <HeroBody>
                      {money.fmt(personal.safeToSpendPerDay)} a day for {personal.daysLeftInMonth}{' '}
                      day{personal.daysLeftInMonth === 1 ? '' : 's'}
                    </HeroBody>
                  </View>
                </GradientHero>
              </Pressable>
            ) : null}

            {isBusiness && sales ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  router.push('/invoices');
                }}
              >
                <GradientHero tone={overdue > 0 ? 'risk' : 'brand'}>
                  <View style={{ gap: space.xs }}>
                    <HeroLabel>{overdue > 0 ? 'Overdue from customers' : 'Awaiting payment'}</HeroLabel>
                    <HeroFigure small>
                      {money.fmt(overdue > 0 ? sales.overdue : sales.outstanding)}
                    </HeroFigure>
                    <HeroBody>
                      {overdue > 0
                        ? `${money.fmt(sales.outstanding)} outstanding in total`
                        : 'Nothing overdue'}
                    </HeroBody>
                  </View>
                </GradientHero>
              </Pressable>
            ) : null}

            <MenuContent onNavigate={onClose} />

            <Small style={{ textAlign: 'center' }}>
              Snap Apps · {isBusiness ? 'business' : 'personal'}
              {IS_DEMO ? ' · demo data' : ''}
            </Small>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
