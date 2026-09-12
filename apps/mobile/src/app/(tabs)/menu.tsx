import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuContent } from '@/components/MenuContent';
import { Figure, Screen, Small } from '@/components/ui';
import { space } from '@/theme';

/**
 * Fallback for the Menu tab.
 *
 * The tab press is intercepted in `_layout.tsx` and opens the sidebar, so this
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
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxxl,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.xs }}>
          <Figure size="h1">Menu</Figure>
          <Small>Tap Menu in the tab bar to open this as a panel.</Small>
        </View>
        <MenuContent />
      </ScrollView>
    </Screen>
  );
}
