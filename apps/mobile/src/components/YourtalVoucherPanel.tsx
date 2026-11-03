import type { YourtalLinkStatus } from '@snap/api-contract';
import { View } from 'react-native';

import { Field } from '@/components/form';
import { Body, Button, Card, Notice, SectionHeader, Small } from '@/components/ui';
import {
  VOUCHER_COPY,
  grantedMessage,
  redemptionLabel,
  voucherErrorMessage,
  voucherUnavailableNote,
  type VoucherOutcome,
} from '@/lib/yourtal-voucher';
import { space } from '@/theme';

export interface YourtalVoucherPanelProps {
  vouchers: NonNullable<YourtalLinkStatus['vouchers']>;
  /** The workspace the scans go to, for "50 scans added to {workspace}". */
  workspaceName: string;
  code: string;
  onCodeChange: (code: string) => void;
  onSubmit: (code: string) => void;
  busy: boolean;
  outcome: VoucherOutcome | null;
}

/**
 * "Use a YourTal voucher" (group plan 2.8, docs/28 §5): controlled, so every
 * state renders from props (`YourtalVoucherPanel.test.tsx`). The form shows
 * only when the server says `available`; a region or role refusal is explained,
 * anything else renders nothing. A voucher adds scans, never money.
 */
export function YourtalVoucherPanel({ vouchers, workspaceName, code, onCodeChange, onSubmit, busy, outcome }: YourtalVoucherPanelProps) {
  const note = voucherUnavailableNote(vouchers);
  if (!vouchers.available && !note) return null;

  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={VOUCHER_COPY.title} />
      {note ? (
        <Small>{note}</Small>
      ) : (
        <Card>
          <View style={{ gap: space.md }}>
            <Small>{VOUCHER_COPY.intro}</Small>
            <Field
              label={VOUCHER_COPY.codeLabel}
              value={code}
              onChangeText={onCodeChange}
              placeholder={VOUCHER_COPY.codePlaceholder}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <Small>{VOUCHER_COPY.hint}</Small>
            {outcome?.kind === 'granted' ? (
              <Notice tone="good" icon="check">
                {grantedMessage(outcome.credits, workspaceName)}
              </Notice>
            ) : null}
            {outcome?.kind === 'pending' ? <Notice tone="warn" icon="alert">{VOUCHER_COPY.pending}</Notice> : null}
            {outcome?.kind === 'error' ? (
              <Notice tone="risk" icon="alert">
                {voucherErrorMessage(outcome.code, outcome.redeemedAt)}
              </Notice>
            ) : null}
            <Button
              label={VOUCHER_COPY.button}
              busy={busy}
              disabled={code.trim() === ''}
              onPress={() => onSubmit(code)}
            />
          </View>
        </Card>
      )}
      {vouchers.redemptions.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <Body strong>{VOUCHER_COPY.historyTitle}</Body>
          {vouchers.redemptions.map((r) => (
            <Small key={r.id}>{redemptionLabel(r)}</Small>
          ))}
        </View>
      ) : null}
    </View>
  );
}
