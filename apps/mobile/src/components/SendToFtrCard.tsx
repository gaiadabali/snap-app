import { View } from 'react-native';

import { Body, Button, Card, Small } from '@/components/ui';
import { space } from '@/theme';

/** Hands this year's deductions to Free Tax Returns as a file. Presentational: the screen fetches and shares. */
export function SendToFtrCard({ busy, onSend }: { busy: boolean; onSend: () => void }) {
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Body strong>Doing your tax return with Free Tax Returns?</Body>
        <Small>
          Save your deductions for this financial year as a file and upload it there. It lists each
          deduction with its total and a fingerprint of each receipt. It has no merchant names and
          does not include the receipt images.
        </Small>
        <Button label="Send to Free Tax Returns" busy={busy} onPress={onSend} />
      </View>
    </Card>
  );
}
