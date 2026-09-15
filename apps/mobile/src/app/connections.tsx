import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Connection } from '@/api';
import { Loading } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, Button, Card, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { space, usePalette } from '@/theme';

/**
 * Pushing to an accounting ledger.
 *
 * Xero is the one that matters in Australia; MYOB and QuickBooks are listed
 * because a small business asks about them and a silent absence reads as
 * "never". They share one outbound queue, which is the part worth building
 * once: rate-limited, retried, and carrying the original image as an
 * attachment on every transaction it pushes.
 */
export default function ConnectionsScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setConnections(await api().listConnections());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function connect(c: Connection) {
    setBusy(c.id);
    try {
      // Linking is an OAuth round trip that LEAVES the app: the server hands
      // back the provider's authorise URL and the connection only exists once
      // the callback has landed. So nothing is marked connected here — the
      // list is reloaded when the user comes back, and reports the truth.
      const { authorizeUrl } = await api().connectAccounting(c.id);
      const opened = await Linking.canOpenURL(authorizeUrl);
      if (!opened) {
        Alert.alert(`Could not open ${c.name}`, 'No browser is available to sign in with.');
        return;
      }
      await Linking.openURL(authorizeUrl);
    } catch (error) {
      Alert.alert(
        `Could not connect ${c.name}`,
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    } finally {
      setBusy(null);
    }
  }

  function disconnect(c: Connection) {
    Alert.alert(
      `Disconnect ${c.name}?`,
      'Nothing already pushed is removed from your ledger. New documents stop syncing until you reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setBusy(c.id);
            void api()
              .disconnectAccounting(c.id)
              .then(setConnections)
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {connections === null ? (
          <Loading />
        ) : (
          <>
            {connections.map((c) => {
              const on = c.status === 'connected';
              return (
                <Raised key={c.id} style={{ gap: space.md }} accent={on ? p.accent : undefined}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Figure size="h2">{c.name}</Figure>
                      <Small>{c.note}</Small>
                    </View>
                    <Chip tone={on ? 'accent' : 'neutral'}>{on ? 'Connected' : 'Not connected'}</Chip>
                  </View>

                  {on ? (
                    <>
                      <View style={{ flexDirection: 'row', gap: space.lg }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Label>Organisation</Label>
                          <Body strong numberOfLines={1}>
                            {c.organisation}
                          </Body>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Label>Waiting to push</Label>
                          <Body strong>{c.queued} documents</Body>
                        </View>
                      </View>
                      <Button
                        label="Disconnect"
                        tone="outline"
                        onPress={() => disconnect(c)}
                        disabled={busy === c.id}
                      />
                    </>
                  ) : (
                    <Button
                      label={`Connect ${c.name}`}
                      onPress={() => void connect(c)}
                      busy={busy === c.id}
                      disabled={busy !== null}
                    />
                  )}
                </Raised>
              );
            })}

            <Card>
              <View style={{ gap: space.xs }}>
                <Label>What gets pushed</Label>
                <Body>
                  Only confirmed documents. Anything still awaiting review stays here — pushing an
                  unchecked extraction into a ledger creates work for whoever reconciles it.
                </Body>
                <Small>
                  Each transaction carries its original image as an attachment, so the evidence
                  travels with the entry rather than living in a second system.
                </Small>
              </View>
            </Card>

            <Small style={{ textAlign: 'center' }}>
              Connecting opens {connections[0]?.name ?? 'the provider'} to authorise access. Snap
              Apps never sees your ledger password.
            </Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
