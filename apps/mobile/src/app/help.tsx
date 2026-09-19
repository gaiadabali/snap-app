import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Card, Divider, Row, Screen, ScreenHeader, Small } from '@/components/ui';
import { control, space, type, usePalette } from '@/theme';

/**
 * The questions that actually come in, answered in full.
 *
 * An accordion rather than a list of links: every answer is three sentences,
 * and sending someone to a web page for three sentences is how a support
 * queue fills up. Nothing here needs the network.
 */
const TOPICS: Array<{ q: string; a: string }> = [
  {
    q: 'What is a credit, exactly?',
    a: 'One credit is one page. A single receipt costs one; a two-page invoice costs two. A scan that fails to read costs nothing — you are never charged for our mistake.',
  },
  {
    q: 'Why does a receipt need checking?',
    a: 'The reader gives every field a confidence score. Anything below the threshold is held for you rather than filed quietly, because a wrong figure that looks confident is worse than one that asks.',
  },
  {
    q: 'Can I use this without the internet?',
    a: 'Yes. Photos are captured and held on the phone, and upload when signal returns. Nothing is lost in a car park with no bars.',
  },
  {
    q: 'What happens to the original photo?',
    a: 'It is kept exactly as taken — never cropped, never recompressed. That unmodified original is what makes the record hold up if it is ever questioned.',
  },
  {
    q: 'Who else can see my receipts?',
    a: 'Everyone in the same space, and nobody else. Removing a person revokes their access but leaves what they captured, because those records belong to the space rather than to them.',
  },
  {
    q: 'How do I get my data out?',
    a: 'Privacy and data, then Export receipts. You get every original photo for the period you pick, zipped with a summary sheet of the fields we read.',
  },
];

export default function HelpScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(null);

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
        <ScreenHeader title="Help" onBack={() => router.back()} />
        <Text style={[type.body, { color: p.inkMuted }]}>
          The answers below cover most of what comes up. Anything else, write to us.
        </Text>

        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>Common questions</Text>
          <Card padded={false}>
            {TOPICS.map((t, i) => {
              const on = open === i;
              return (
                <View key={t.q} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.rule }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: on }}
                    onPress={() => setOpen(on ? null : i)}
                    style={({ pressed }) => ({
                      minHeight: control.tap + 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: 14,
                      backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                    })}
                  >
                    <Text style={[type.bodyStrong, { flex: 1, color: p.ink }]}>{t.q}</Text>
                    <View style={{ transform: [{ rotate: on ? '180deg' : '0deg' }] }}>
                      <Icon name="chevronDown" size={18} color={p.inkMuted} />
                    </View>
                  </Pressable>
                  {on ? (
                    <Text
                      style={[
                        type.small,
                        { color: p.inkMuted, paddingHorizontal: space.lg, paddingBottom: space.lg },
                      ]}
                    >
                      {t.a}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>Still stuck</Text>
          <Card padded={false}>
            <Row
              title="Email support"
              subtitle="hello@snap-apps.com.au · usually same day"
              icon="doc"
              iconTone="neutral"
              onPress={() => void Linking.openURL('mailto:hello@snap-apps.com.au')}
            />
            <Divider />
            <Row
              title="Report a problem"
              subtitle="Send a diagnostic with your last few scans"
              icon="alert"
              iconTone="neutral"
              onPress={() =>
                void Linking.openURL(
                  'mailto:hello@snap-apps.com.au?subject=Problem%20report%20(Snap%20Apps%200.1.0)',
                )
              }
            />
          </Card>
        </View>

        <Small style={{ textAlign: 'center' }}>
          Snap Apps 0.1.0 · your receipts stay in this space while we look into anything you
          report.
        </Small>
      </ScrollView>
    </Screen>
  );
}
