import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { WalletProvider } from '@/api';
import { Icon, type IconName } from '@/components/Icon';
import { IconTile, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { space, type, usePalette } from '@/theme';

/**
 * Where a top-up charge comes from.
 *
 * A separate screen from the card form because the two wallets have nothing to
 * type — picking Apple Pay is the whole interaction — and folding them into a
 * form would mean showing four empty card fields to someone who is not
 * entering a card.
 *
 * Drawn as one ledger of lines under a single label rather than a boxed list
 * (the instrument pass): seven choices of the same kind are a list, and a list
 * is hairlines on the ground.
 */
const PROVIDERS: Array<{
  id: string;
  provider: WalletProvider;
  label: string;
  hint: string;
  icon: IconName;
}> = [
  { id: 'cba', provider: 'card', label: 'Commonwealth Bank', hint: 'Debit or credit card', icon: 'card' },
  { id: 'nab', provider: 'card', label: 'NAB', hint: 'Debit or credit card', icon: 'card' },
  { id: 'anz', provider: 'card', label: 'ANZ', hint: 'Debit or credit card', icon: 'card' },
  { id: 'westpac', provider: 'card', label: 'Westpac', hint: 'Debit or credit card', icon: 'card' },
  { id: 'other', provider: 'card', label: 'Another card', hint: 'Any Visa, Mastercard or Amex', icon: 'card' },
  { id: 'apple', provider: 'apple-pay', label: 'Apple Pay', hint: 'Confirm with Face ID', icon: 'wallet' },
  { id: 'google', provider: 'google-pay', label: 'Google Pay', hint: 'Use the card on this device', icon: 'wallet' },
];

export default function AddPaymentMethodScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.md }}>
          <ScreenHeader title="Payment method" onBack={() => router.back()} />
          <Text style={[type.body, { color: p.inkMuted }]}>
            Pick where the charge comes from. You can add more later and switch between them.
          </Text>
        </View>

        <Section label="Bank or wallet">
          {PROVIDERS.map((pv, i) => (
            <Pressable
              key={pv.id}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/wallet/card',
                  params: { provider: pv.provider, label: pv.label },
                })
              }
              style={({ pressed }) => ({
                minHeight: 60,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: space.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: p.rule,
                backgroundColor: pressed ? p.surface : 'transparent',
              })}
            >
              <IconTile name={pv.icon} tone="neutral" />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
                  {pv.label}
                </Text>
                <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={2}>
                  {pv.hint}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={p.inkFaint} />
            </Pressable>
          ))}
        </Section>

        <Small>Card details are held by the payment processor, not by Snap Apps.</Small>
      </ScrollView>
    </Screen>
  );
}
