import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { shareInvoicePdf } from '@/lib/share';
import { api, type Invoice } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

export default function InvoiceScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (id) void api().getInvoice(id).then(setInv);
  }, [id]);

  if (!inv) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Small>Loading…</Small>
        </View>
      </Screen>
    );
  }

  const overdue = inv.status === 'overdue';
  const paid = inv.status === 'paid';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <GradientHero tone={overdue ? 'risk' : 'brand'}>
          <View style={{ gap: space.xs }}>
            <HeroLabel>
              {paid ? 'Paid in full' : overdue ? 'Overdue' : inv.kind === 'estimate' ? 'Estimate' : 'Amount due'}
            </HeroLabel>
            <HeroFigure>{formatAud(paid ? inv.totalAmount : inv.amountDue)}</HeroFigure>
            <HeroBody>
              {inv.number} · {inv.partyName}
              {!paid ? ` · due ${formatShortDate(inv.dueDate)}` : ''}
            </HeroBody>
          </View>
        </GradientHero>

        {/* ── Lines ── */}
        <Raised>
          <View style={{ gap: space.md }}>
            <Label>Lines</Label>
            <Divider />
            {inv.lines.map((l) => (
              <View key={l.lineNumber} style={{ gap: 3 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: space.md,
                  }}
                >
                  <Body strong style={{ flexShrink: 1 }}>
                    {l.description}
                  </Body>
                  <Figure>{formatAud(l.netAmount)}</Figure>
                </View>
                <Small>
                  {l.quantity} {l.unit} × {formatAud(l.unitPrice)} · GST {formatAud(l.gstAmount)}
                </Small>
              </View>
            ))}
            <Divider />
            <Row label="Subtotal (ex GST)" value={formatAud(inv.netAmount)} />
            <Row
              label="GST"
              value={formatAud(inv.gstAmount)}
              hint="10% added to the ex-GST price — the inverse of a purchase receipt, where GST is 1/11 of the total"
            />
            <Row label="Total" value={formatAud(inv.totalAmount)} strong />
            {Number(inv.amountPaid) > 0 ? (
              <Row label="Paid" value={`−${formatAud(inv.amountPaid)}`} tone="accent" />
            ) : null}
            {!paid ? (
              <Row label="Due" value={formatAud(inv.amountDue)} tone={overdue ? 'risk' : 'ink'} strong />
            ) : null}
          </View>
        </Raised>

        {/* ── Where it lands on the BAS ── */}
        <Raised>
          <View style={{ gap: space.sm }}>
            <Label>On your BAS</Label>
            <Body>
              This {inv.kind} contributes {formatAud(inv.totalAmount)} to <Body strong>G1</Body> and{' '}
              {formatAud(inv.gstAmount)} to <Body strong>1A</Body> — GST you have collected and owe
              the ATO.
            </Body>
            <Small>
              Sales GST is money you hold on the ATO&rsquo;s behalf, not income. It is the mirror of
              the 1B credits on your purchases.
            </Small>
          </View>
        </Raised>

        <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
          <Chip tone={paid ? 'accent' : overdue ? 'risk' : 'warn'}>{inv.status}</Chip>
          <Chip>{inv.kind}</Chip>
          <Chip>Issued {formatShortDate(inv.issueDate)}</Chip>
        </View>

        {/* An accepted quote becomes a tax invoice here. It is a copy: the
            estimate stays on file as what the customer actually agreed to. */}
        {inv.kind === 'estimate' ? (
          <View style={{ gap: space.sm }}>
            <Button
              label="Convert to an invoice"
              busy={converting}
              onPress={() => {
                setConverting(true);
                void api()
                  .convertEstimate(inv.id)
                  .then((made) => router.replace(`/invoice/${made.id}`))
                  .catch((e: unknown) =>
                    Alert.alert(
                      'Cannot convert',
                      e instanceof Error ? e.message : 'Unknown error',
                    ),
                  )
                  .finally(() => setConverting(false));
              }}
            />
            <Small style={{ textAlign: 'center' }}>
              Creates a draft invoice with the GST recalculated. Nothing is sent until you send it.
            </Small>
          </View>
        ) : null}

        {/* These two did nothing at all — buttons with an empty handler, which
            is worse than no button: the user taps, nothing happens, and they
            cannot tell whether the app is broken or they are. Both now work. */}
        {!paid ? (
          <Button label="Record payment" onPress={() => router.push('/payments')} />
        ) : null}
      
        {/* Sending leaves through the OS share sheet rather than an in-app
            mailer: the customer's copy is a document the user can see and
            check before it goes. */}
        <Button
          label="Send as PDF"
          onPress={() => {
            if (!inv) return;
            void shareInvoicePdf(inv, {
              name: 'K. Marsh Transport',
              abn: '51824753556',
            });
          }}
        />
</ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  hint,
  tone = 'ink',
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ink' | 'accent' | 'risk';
  strong?: boolean;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: space.md,
        }}
      >
        <Body muted={!strong} strong={strong} style={{ flexShrink: 1 }}>
          {label}
        </Body>
        <Figure size={strong ? 'h2' : 'body'} tone={tone}>
          {value}
        </Figure>
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}
