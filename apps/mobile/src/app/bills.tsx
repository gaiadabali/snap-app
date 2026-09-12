import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Bill } from '@/api';
import { Empty, Field, Loading, Sheet, StatRow } from '@/components/form';
import { CategoryIcon, GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

/**
 * Bills: money you owe, and when.
 *
 * Deliberately separate from receipts. A receipt is proof you have already
 * paid — its job is to defend a GST credit. A bill is an obligation with a
 * date on it, and the only question it asks is whether you are about to miss
 * it. Mixing the two into one list buries the three that are due this week
 * under the four hundred that are settled.
 */

function daysUntil(iso: string): number {
  const then = new Date(`${iso}T00:00:00`);
  const now = new Date();
  return Math.round((+then - +new Date(now.toDateString())) / 86_400_000);
}

function dueCopy(bill: Bill): { text: string; tone: 'risk' | 'warn' | 'muted' } {
  if (bill.status === 'paid') return { text: `Paid · ${formatShortDate(bill.issueDate)}`, tone: 'muted' };
  const days = daysUntil(bill.dueDate);
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, tone: 'risk' };
  if (days === 0) return { text: 'Due today', tone: 'risk' };
  if (days <= 7) return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'warn' };
  return { text: `Due ${formatShortDate(bill.dueDate)}`, tone: 'muted' };
}

export default function BillsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBills(await api().listBills());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const all = bills ?? [];
  const open = all.filter((b) => b.status !== 'paid');
  const overdue = open.filter((b) => b.status === 'overdue');
  const owed = open.reduce((a, b) => a + Number(b.amountDue), 0);
  const overdueTotal = overdue.reduce((a, b) => a + Number(b.amountDue), 0);
  const gstOnUnpaid = open.reduce((a, b) => a + Number(b.gstAmount), 0);

  function pay(bill: Bill) {
    Alert.alert(
      bill.supplierName,
      `${formatAud(bill.amountDue)} outstanding on ${bill.reference}. Recording a payment does not move any money.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Part payment',
          onPress: () => {
            setPaying(bill);
            setAmount(Number(bill.amountDue).toFixed(2));
            setError(null);
          },
        },
        {
          text: 'Pay in full',
          onPress: () => {
            setBusy(bill.id);
            void api()
              .payBill(bill.id)
              .then(() => load())
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  async function payPart() {
    if (!paying) return;
    setError(null);
    try {
      await api().payBill(paying.id, Number(amount).toFixed(4));
      await load();
      setPaying(null);
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
        {bills === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero tone={overdueTotal > 0 ? 'risk' : 'brand'}>
              <View style={{ gap: space.xs }}>
                <HeroLabel>{overdueTotal > 0 ? 'Overdue to suppliers' : 'Owed to suppliers'}</HeroLabel>
                <HeroFigure>{formatAud(overdueTotal > 0 ? overdueTotal.toFixed(4) : owed.toFixed(4))}</HeroFigure>
                <HeroBody>
                  {open.length} unpaid bill{open.length === 1 ? '' : 's'}
                  {overdueTotal > 0 ? ` · ${formatAud(owed.toFixed(4))} in total` : ''}
                </HeroBody>
              </View>
            </GradientHero>

            <Raised>
              <StatRow
                stats={[
                  { label: 'Overdue', value: String(overdue.length), hint: 'Past their due date' },
                  {
                    label: 'GST on unpaid',
                    value: formatAud(gstOnUnpaid.toFixed(4), { cents: false }),
                    hint: 'Claimable once paid, on cash basis',
                  },
                ]}
              />
            </Raised>

            {all.length === 0 ? (
              <Empty title="No bills" detail="Bills you owe will appear here with their due dates." />
            ) : null}

            {['overdue', 'unpaid', 'paid'].map((status) => {
              const group = all.filter((b) => b.status === status);
              if (group.length === 0) return null;
              return (
                <View key={status} style={{ gap: space.sm }}>
                  <Label>
                    {status === 'overdue' ? 'Overdue' : status === 'unpaid' ? 'Coming up' : 'Paid'}
                  </Label>
                  <Raised style={{ padding: 0 }}>
                    {group.map((b, i) => {
                      const due = dueCopy(b);
                      return (
                        <View key={b.id}>
                          {i > 0 ? <Divider style={{ marginLeft: 68 }} /> : null}
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: space.md,
                              paddingHorizontal: space.lg,
                              paddingVertical: 13,
                              opacity: b.status === 'paid' ? 0.6 : 1,
                            }}
                          >
                            <CategoryIcon category={b.category} size={38} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Body strong numberOfLines={1}>
                                {b.supplierName}
                              </Body>
                              <View
                                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                              >
                                <Small numberOfLines={1}>{b.reference}</Small>
                                <Small
                                  muted={due.tone === 'muted'}
                                  style={{
                                    color:
                                      due.tone === 'risk'
                                        ? p.risk
                                        : due.tone === 'warn'
                                          ? p.warn
                                          : undefined,
                                    fontWeight: due.tone === 'muted' ? '400' : '700',
                                  }}
                                >
                                  {due.text}
                                </Small>
                              </View>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 4 }}>
                              <Figure size="h2">{formatAud(b.amountDue || b.totalAmount)}</Figure>
                              {Number(b.amountPaid) > 0 && b.status !== 'paid' ? (
                                <Small>{formatAud(b.amountPaid)} paid</Small>
                              ) : null}
                              {b.status === 'paid' ? (
                                <Chip tone="accent">Paid</Chip>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Mark ${b.supplierName} as paid`}
                                  onPress={() => pay(b)}
                                  disabled={busy === b.id}
                                  hitSlop={6}
                                >
                                  <Chip tone={b.status === 'overdue' ? 'risk' : 'accent'}>
                                    {busy === b.id ? 'Saving…' : 'Mark paid'}
                                  </Chip>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </Raised>
                </View>
              );
            })}

            <Small style={{ textAlign: 'center' }}>
              On a cash basis the GST on a bill is claimable in the quarter you pay it, not the
              quarter it was issued.
            </Small>

            <Button label="Done" tone="outline" onPress={() => void load()} />
          </>
        )}
      </ScrollView>
    
      <Sheet
        open={paying !== null}
        title="Part payment"
        subtitle={paying ? `${paying.supplierName} · ${paying.reference}` : undefined}
        error={error}
        submitLabel="Record"
        submitDisabled={Number(amount) <= 0}
        onClose={() => setPaying(null)}
        onSubmit={payPart}
      >
        <Field
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          prefix="$"
          autoFocus
          hint={paying ? `${formatAud(paying.amountDue)} outstanding` : undefined}
        />
      </Sheet>
    </Screen>
  );
}
