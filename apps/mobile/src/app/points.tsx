import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { YourtalLinkPanel } from '@/components/YourtalLinkPanel';
import { useYourtalLink } from '@/components/useYourtalLink';
import { Screen, ScreenHeader, Small } from '@/components/ui';
import { YOURTAL_WEB_URL } from '@/config';
import { LINK_COPY, yourtalLinks } from '@/lib/yourtal-link';
import { space } from '@/theme';

const LINKS = yourtalLinks(YOURTAL_WEB_URL);

/**
 * Points: YourTal's, paid in YourTal (`docs/ECOSYSTEM.md` D33).
 *
 * Snap Apps used to keep its own point per scan. The founder retired that
 * (2026-10-20): YourTal points are the only points with value, so this screen
 * is the link to a YourTal account and what YourTal said it paid, not a
 * Snap Apps balance. The balance itself lives in the person's YourTal wallet.
 *
 * Reads and writes `GET / POST / DELETE /v1/yourtal/link`, none of which sends
 * a workspace header: the link belongs to the person. When the server has no
 * YourTal credentials (`available: false`) the whole feature is hidden, so
 * this route sends the person home rather than showing a link that cannot work.
 */
export default function PointsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const yt = useYourtalLink();
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  if (yt.load.kind === 'ready' && !yt.load.status.available) return <Redirect href="/" />;

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.xs }}>
          <ScreenHeader title={LINK_COPY.title} onBack={() => router.back()} />
          <Small>
            Receipts you scan earn points in YourTal. They are paid there, and your balance is in
            your YourTal wallet.
          </Small>
        </View>

        <YourtalLinkPanel
          load={yt.load}
          links={LINKS}
          code={code}
          onCodeChange={(v) => {
            setCode(v);
            if (yt.error) yt.clearError();
          }}
          onLink={async (c) => {
            if (await yt.link(c)) setCode('');
          }}
          busy={yt.busy}
          error={yt.error}
          confirming={confirming}
          onAskUnlink={() => {
            yt.clearError();
            setConfirming(true);
          }}
          onCancelUnlink={() => setConfirming(false)}
          onConfirmUnlink={async () => {
            // Stay on the confirm step when it fails, so the error shows under it and Unlink can be tried again.
            if (await yt.unlink()) setConfirming(false);
          }}
          onRetry={yt.retry}
          onOpenUrl={(url) => void Linking.openURL(url)}
          onConfirmEmail={() => router.push('/settings')}
        />
      </ScrollView>
    </Screen>
  );
}
