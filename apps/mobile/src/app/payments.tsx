import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Invoice, type Payment, type PaymentMethod } from '@/api';
import { AddButton, Avatar, Choice, Empty, Field, Loading, Sheet } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

/**
 * Money received, recorded against an invoice.
 *
 * A payment is never entered free-standing: it always settles a specific
 * invoice, which is what lets "outstanding" and "overdue" be derived rather
 * than maintained. Two figures that are separately maintained are two figures
 * that will disagree.
 */

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export default function PaymentsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [adding, setAdding] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pay, inv] = await Promise.all([api().listPayments(), api().listInvoices('invoice')]);
    setPayments(pay);
    setInvoices(inv);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const outstanding = invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft');
  const chosen = invoices.find((i) => i.id === invoiceId) ?? null;
  const received = (payments ?? []).reduce((a, x) => a + Number(x.amount), 0);

  function openFor(invoice: Invoice) {
    setInvoiceId(invoice.id);
    // Pre-filled with the full amount due, which is what most payments are.
    setAmount(Number(invoice.amountDue).toFixed(2));
    setReference('');
    setError(null);
    setAdding(true);
  }

  async function save() {
    if (!chosen) return;
    setError(null);
    try {
      await api().recordPayment(chosen.id, Number(amount).toFixed(4), method, reference);
      await load();
      setAdding(false);
      setInvoiceId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that payment.');
    }
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
        {payments === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Received</HeroLabel>
                <HeroFigure>{formatAud(received.toFixed(4))}</HeroFigure>
                <HeroBody>
                  {payments.length} payment{payments.length === 1 ? '' : 's'} ·{' '}
                  {outstanding.length} invoice{outstanding.length === 1 ? '' : 's'} still open
                </HeroBody>
              </View>
            </GradientHero>

            {outstanding.length > 0 ? (
              <View style={{ gap: space.sm }}>
                <Label>Awaiting payment</Label>
                <Raised style={{ padding: 0 }}>
                  {outstanding.map((i, idx) => (
                    <View key={i.id}>
                      {idx > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Record a payment for ${i.number}`}
                        onPress={() => openFor(i)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 13,
                          backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                        })}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong numberOfLines={1}>
                            {i.partyName}
                          </Body>
                          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                            <Small>{i.number}</Small>
                            {i.status === 'overdue' ? <Chip tone="risk">Overdue</Chip> : null}
                          </View>
                        </View>
                        <Figure size="h2">{formatAud(i.amountDue)}</Figure>
                        <Small style={{ fontSize: 16 }}>›</Small>
                      </Pressable>
                    </View>
                  ))}
                </Raised>
              </View>
            ) : null}

            <AddButton
              label="Record a payment"
              onPress={() => {
                const first = outstanding[0];
                if (first) openFor(first);
              }}
            />

            <View style={{ gap: space.sm }}>
              <Label>Received</Label>
              {payments.length === 0 ? (
                <Empty
                  title="Nothing recorded yet"
                  detail="Payments you record against an invoice appear here."
                />
              ) : (
                <Raised style={{ padding: 0 }}>
                  {payments.map((x, i) => (
                    <View key={x.id}>
                      {i > 0 ? <Divider style={{ marginLeft: 64 }} /> : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 13,
                        }}
                      >
                        <Avatar initials={x.partyName.slice(0, 2).toUpperCase()} size={36} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong numberOfLines={1}>
                            {x.partyName}
                          </Body>
                          <Small numberOfLines={1}>
                            {x.invoiceNumber} · {METHODS.find((m) => m.value === x.method)?.label}
                            {x.reference ? ` · ${x.reference}` : ''}
                          </Small>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Figure size="h2">{formatAud(x.amount)}</Figure>
                          <Small>{formatShortDate(x.date)}</Small>
                        </View>
                      </View>
                    </View>
                  ))}
                </Raised>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Sheet
        open={adding}
        title="Record a payment"
        subtitle={chosen ? `${chosen.number} · ${chosen.partyName}` : undefined}
        error={error}
        submitLabel="Record"
        submitDisabled={!chosen || Number(amount) <= 0}
        onClose={() => setAdding(false)}
        onSubmit={save}
      >
        {invoices.length > 1 ? (
          <Choice
            label="Against invoice"
            value={invoiceId ?? ''}
            onChange={(id) => {
              setInvoiceId(id);
              const inv = invoices.find((i) => i.id === id);
              if (inv) setAmount(Number(inv.amountDue).toFixed(2));
            }}
            options={outstanding.map((i) => ({ value: i.id, label: i.number }))}
          />
        ) : null}
        <Field
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          prefix="$"
          hint={chosen ? `${formatAud(chosen.amountDue)} outstanding` : undefined}
        />
        <Choice label="Method" value={method} onChange={setMethod} options={METHODS} />
        <Field
          label="Reference"
          value={reference}
          onChangeText={setReference}
          placeholder="EFT 22 Sep"
        />
      </Sheet>
    </Screen>
  );
}
