import type { MailSummary } from '@snap/mail-engine';
import { useMailSummary } from '@snap/mail-engine/react';
import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Body, Button, Card, Label, Small } from '@/components/ui';
import { safeHttpsUrl } from '@/lib/mail-text';
import { space, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { openOutside } from './MessageText';

const nf = new Intl.NumberFormat('en-AU');

const COUNTERS = [
  ['Bulk mail filed, last 30 days', 'bulkFiled30d'],
  ['Senders you have unsubscribed from', 'marketersUnsubscribed'],
  ['Replies sent to marketers, last 30 days', 'autoRepliesSent30d'],
] as const;

/**
 * The YourTal ad and the three counters, shown at the top of Spam (spambank/BUILD.md §4.13).
 *
 * The title, body and button label come from the server and are shown as plain text. The
 * button is drawn only when its address is plain https, and opens in the phone's browser.
 * A missing banner (`null`) still shows the counters, and a missing summary shows nothing:
 * this is an extra, not something the folder should wait for.
 */
export function SpamBannerView({ summary }: { summary: MailSummary | null }) {
  const p = usePalette();
  if (!summary) return null;
  const { banner, counters } = summary;
  const href = safeHttpsUrl(banner?.ctaUrl);
  return (
    <Card tone="accent" style={{ gap: space.md }} padded>
      {banner ? (
        <View style={{ gap: space.sm }}>
          <Label style={{ color: p.accentText }}>From YourTal</Label>
          <Body strong>{banner.title}</Body>
          <Small>{banner.body}</Small>
          {href ? (
            <Button
              label={banner.ctaLabel}
              onPress={() => openOutside(href)}
              icon="forward"
              style={{ alignSelf: 'flex-start', marginTop: space.xs }}
            />
          ) : null}
        </View>
      ) : null}
      <View
        accessibilityLabel="Spam folder counters"
        style={{ flexDirection: 'row', gap: space.sm }}
      >
        {COUNTERS.map(([label, key]) => (
          <View
            key={key}
            accessible
            accessibilityLabel={`${label}: ${nf.format(counters[key])}`}
            style={{ flex: 1, gap: 2, alignItems: 'center' }}
          >
            <Text style={{ color: p.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' }}>{nf.format(counters[key])}</Text>
            <Small style={{ textAlign: 'center', fontSize: 11, lineHeight: 14 }}>{label}</Small>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="shield" size={14} color={p.inkMuted} />
        <Small style={{ flex: 1, fontSize: 12 }}>Nothing in Spam can reach your Inbox.</Small>
      </View>
    </Card>
  );
}

export function SpamBanner() {
  const { summary } = useMailSummary('en-AU');
  return <SpamBannerView summary={summary} />;
}
