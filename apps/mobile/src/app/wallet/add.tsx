import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { WalletProvider } from '@/api';
import { type IconName } from '@/components/Icon';
import { Card, Row, Screen, ScreenHeader, Small } from '@/components/ui';
import { space, type, usePalette } from '@/theme';

/**
 * Where a top-up charge comes from.
 *
 * A separate screen from the card form because the two wallets have nothing to
 * type — picking Apple Pay is the whole interaction — and folding them into a
 * form would mean showing four empty card fields to someone who is not
 * entering a card.
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
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
      >
        <ScreenHeader title="Payment method" onBack={() => router.back()} />
        <Text style={[type.body, { color: p.inkMuted }]}>
          Pick where the charge comes from. You can add more later and switch between them.
        </Text>

        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>Bank or wallet</Text>
          <Card padded={false}>
            {PROVIDERS.map((pv, i) => (
              <View
                key={pv.id}
                style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.rule }}
              >
                <Row
                  title={pv.label}
                  subtitle={pv.hint}
                  icon={pv.icon}
                  iconTone="neutral"
                  onPress={() =>
                    router.push({
                      pathname: '/wallet/card',
                      params: { provider: pv.provider, label: pv.label },
                    })
                  }
                />
              </View>
            ))}
          </Card>
        </View>

        <Small>Card details are held by the payment processor, not by Snap Apps.</Small>
      </ScrollView>
    </Screen>
  );
}
