import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';

import { api, type Invoice } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

/** Status carries its own colour, so a list sorts itself before it is read. */
function statusTone(s: Invoice['status']): 'neutral' | 'accent' | 'risk' | 'warn' {
  return s === 'paid' ? 'accent' : s === 'overdue' ? 'risk' : s === 'sent' ? 'warn' : 'neutral';
}

export default function InvoicesScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = params.kind === 'estimate' ? 'estimate' : 'invoice';
  const [rows, setRows] = useState<Invoice[] | null>(null);

  useEffect(() => {
    void api().listInvoices(kind).then(setRows);
  }, [kind]);

  const all = rows ?? [];
  const outstanding = useMemo(
    () =>
      all
        .filter((i) => i.status !== 'paid' && i.status !== 'draft')
        .reduce((a, i) => a + Number(i.amountDue), 0),
    [all],
  );
  const overdueCount = all.filter((i) => i.status === 'overdue').length;

  // Grouped by status so the ones needing action sit at the top.
  const sections = useMemo(() => {
    const order: Array<Invoice['status']> = ['overdue', 'sent', 'draft', 'paid'];
    const titles: Record<Invoice['status'], string> = {
      overdue: 'Overdue',
      sent: kind === 'estimate' ? 'Awaiting reply' : 'Awaiting payment',
      draft: 'Drafts',
      paid: 'Paid',
    };
    return order
      .map((st) => ({ title: titles[st], status: st, data: all.filter((i) => i.status === st) }))
      .filter((s) => s.data.length > 0);
  }, [all, kind]);

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <GradientHero tone={overdueCount > 0 ? 'risk' : 'brand'}>
              <View style={{ gap: space.xs }}>
                <HeroLabel>
                  {kind === 'estimate' ? 'Quoted, not yet won' : 'Owed to you'}
                </HeroLabel>
                <HeroFigure>{formatAud(String(outstanding.toFixed(2)))}</HeroFigure>
                <HeroBody>
                  {all.length} {kind}
                  {all.length === 1 ? '' : 's'}
                  {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
                </HeroBody>
              </View>
            </GradientHero>
            {kind === 'invoice' ? (
              <Button label="＋  New invoice" onPress={() => router.push('/invoice/new')} />
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ paddingTop: space.md, paddingBottom: space.xs }}>
            <Label>{section.title}</Label>
          </View>
        )}
        ListEmptyComponent={
          rows === null ? null : (
            <View style={{ padding: space.xxl, alignItems: 'center', gap: space.sm }}>
              <Figure size="h2">No {kind}s yet</Figure>
              <Small>Create one to start getting paid.</Small>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/invoice/${item.id}`)}
            style={{ marginBottom: space.sm }}
          >
            <Raised
              accent={
                item.status === 'overdue' ? p.risk : item.status === 'paid' ? p.accent : undefined
              }
            >
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body strong numberOfLines={1}>
                      {item.partyName}
                    </Body>
                    <Small>
                      {item.number} · {formatShortDate(item.issueDate)}
                    </Small>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Figure size="h2">{formatAud(item.totalAmount)}</Figure>
                    <Chip tone={statusTone(item.status)}>
                      {item.status === 'sent' ? `Due ${formatShortDate(item.dueDate)}` : item.status}
                    </Chip>
                  </View>
                </View>
                {Number(item.amountDue) > 0 && item.status !== 'draft' ? (
                  <Small>
                    {formatAud(item.amountDue)} outstanding · incl {formatAud(item.gstAmount)} GST
                  </Small>
                ) : null}
              </View>
            </Raised>
          </Pressable>
        )}
      />
    </Screen>
  );
}
