import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuContent } from '@/components/MenuContent';
import { Figure, Screen, Small } from '@/components/ui';
import { space } from '@/theme';

/**
 * Fallback for the Menu tab.
 *
 * The bottom bar's Menu button opens the sidebar sheet instead of navigating, so this
 * is normally never rendered. It exists because expo-router needs a file to
 * register the tab, and because a deep link straight to /menu should still show
 * something useful rather than a blank screen.
 */
export default function MenuScreen() {
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.xs }}>
          <Figure size="h1">Menu</Figure>
          <Small>The Menu button in the bottom bar opens this as a sheet.</Small>
        </View>
        <MenuContent />
      </ScrollView>
    </Screen>
  );
}
