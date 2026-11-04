import { Linking, View } from 'react-native';

import { Body, Button, Card, Small } from '@/components/ui';
import { FTR_SEND_COPY } from '@/lib/ftr-send';
import { space } from '@/theme';

/** How the last send ended; `message` is a fixed sentence from `lib/ftr-send.ts`. */
export type FtrSendState = { kind: 'sent'; year: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string } | null;

/**
 * Hands this year's deductions to Free Tax Returns. Presentational: the screen runs the send and the share.
 * With `directSend` the person can send straight through YourTal; the file is always still offered.
 */
export function SendToFtrCard({
  financialYear,
  busy,
  onSend,
  directSend = false,
  onSendDirect,
  state = null,
  reviewUrl,
}: {
  financialYear: string;
  busy: boolean;
  onSend: () => void;
  directSend?: boolean;
  onSendDirect?: () => void;
  state?: FtrSendState;
  reviewUrl?: string;
}) {
  if (!directSend) {
    return (
      <Card>
        <View style={{ gap: space.sm }}>
          <Body strong>Doing your tax return with Free Tax Returns?</Body>
          <Small>
            Save your {financialYear} deductions as a file and upload it there. It lists each
            deduction with its total and a fingerprint of each receipt. It has no merchant names and
            does not include the receipt images.
          </Small>
          <Button label={`Send ${financialYear} to Free Tax Returns`} busy={busy} onPress={onSend} />
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Body strong>Doing your tax return with Free Tax Returns?</Body>
        {state?.kind === 'sent' ? (
          <View accessibilityLiveRegion="polite" style={{ gap: space.xs }}>
            <Body strong>{FTR_SEND_COPY.sent(state.year)}</Body>
            {reviewUrl ? <Button tone="outline" label={FTR_SEND_COPY.review} onPress={() => void Linking.openURL(reviewUrl)} /> : null}
          </View>
        ) : null}
        {state?.kind === 'cancelled' ? <View accessibilityLiveRegion="polite"><Body strong>{FTR_SEND_COPY.cancelled}</Body></View> : null}
        {state?.kind === 'failed' ? <View accessibilityLiveRegion="assertive"><Body strong>{state.message}</Body></View> : null}
        <Small>{FTR_SEND_COPY.intro(financialYear)}</Small>
        <Button label={FTR_SEND_COPY.send} busy={busy} onPress={onSendDirect ?? onSend} />
        <Button tone="outline" label={FTR_SEND_COPY.file} disabled={busy} onPress={onSend} />
      </View>
    </Card>
  );
}
