import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type DocumentView } from '@/api';
import { Icon } from '@/components/Icon';
import { PERIODS, periodRange, type Period } from '@/components/SearchBar';
import {
  Body,
  Button,
  Card,
  Notice,
  Screen,
  ScreenHeader,
  SectionHeader,
  Small,
} from '@/components/ui';
import { exportDocumentsCsv, exportLinesCsv } from '@/lib/share';
import { numeric, shadow, space, type, usePalette, useTheme } from '@/theme';
import { useMoney } from '@/lib/use-money';

/**
 * Getting everything out, for a period you choose.
 *
 * The count and total are shown BEFORE the button, deliberately: an export is
 * one of the few actions here whose result you cannot inspect inside the app,
 * so the screen has to say exactly what is about to leave it.
 *
 * Nothing is emailed from inside the app — `lib/share.ts` writes to the cache
 * directory and hands the file to the OS share sheet, so the person chooses
 * where a year of their finances goes.
 */
export default function ExportScreen() {
  const money = useMoney();
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [period, setPeriod] = useState<Period>('year');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .listDocuments('all')
        .then((x) => live && setDocs(x))
        .catch(() => live && setDocs([]));
      return () => {
        live = false;
      };
    }, []),
  );

  // Filtered in the client because there is no server-side period filter on
  // `listDocuments` — the receipts screen does the same, from the same range.
  const selected = useMemo(() => {
    if (!docs) return [];
    const { from, to } = periodRange(period);
    return period === 'all' ? docs : docs.filter((d) => d.issueDate >= from && d.issueDate <= to);
  }, [docs, period]);

  const total = useMemo(() => sumMoney(selected.map((d) => d.payableAmount)), [selected]);
  const empty = docs !== null && selected.length === 0;

  async function run(kind: 'documents' | 'lines') {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      if (kind === 'documents') await exportDocumentsCsv(selected, period);
      else await exportLinesCsv(selected, period);
      setDone(
        kind === 'documents'
          ? `${selected.length} receipts handed to your share sheet.`
          : 'Line items handed to your share sheet.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build that export.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Export receipts" onBack={() => router.back()} />
        <Text style={[type.body, { color: p.inkMuted }]}>
          Every receipt in the period you choose, with the fields read from it.
        </Text>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Period" />
          <PeriodCards value={period} onChange={setPeriod} />
        </View>

        <Card style={{ gap: space.md }}>
          <Text style={[type.label, { color: p.inkMuted }]}>In this export</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Body strong>
              {docs === null
                ? 'Counting…'
                : selected.length === 1
                  ? '1 receipt'
                  : `${selected.length} receipts`}
            </Body>
            <Text style={[type.h2, numeric, { color: p.ink }]}>{money.fmt(total)}</Text>
          </View>
          <Small>
            A CSV of the fields, plus a line-item CSV if you want the detail. The original photos
            stay in the app.
          </Small>
        </Card>

        {empty ? (
          <Notice tone="warn" icon="alert">
            Nothing was scanned in this period. Pick a wider one.
          </Notice>
        ) : null}
        {done ? <Notice tone="good" icon="check">{done}</Notice> : null}
        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <View style={{ gap: space.md }}>
          <Button
            label="Export receipts"
            icon="upload"
            busy={busy === 'documents'}
            disabled={selected.length === 0}
            onPress={() => void run('documents')}
          />
          <Button
            label="Export line items"
            tone="outline"
            busy={busy === 'lines'}
            disabled={selected.length === 0}
            onPress={() => void run('lines')}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <Icon name="shield" size={16} color={p.inkMuted} />
          <Small style={{ flex: 1 }}>
            The file is written to this phone and handed to your share sheet. Snap Apps does not
            email it anywhere on your behalf.
          </Small>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The period as selectable cards, two to a row. Selected is a 2px accent border
 * and a check; every card carries a 2px transparent border otherwise, so choosing
 * one never nudges its neighbours. The choice is what the export is about to
 * contain, which earns more weight than a filter chip.
 */
function PeriodCards({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  const p = usePalette();
  const { scheme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {PERIODS.map((x) => {
        const on = value === x.key;
        return (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(x.key)}
            style={({ pressed }) => [
              {
                width: '47.5%',
                flexGrow: 1,
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: space.lg,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: on ? p.accent : 'transparent',
                backgroundColor: p.card,
                opacity: pressed ? 0.85 : 1,
              },
              scheme === 'light' ? shadow.card : null,
              scheme === 'dark' && !on ? { borderColor: p.cardEdge } : null,
            ]}
          >
            <Text style={[type.bodyStrong, { color: on ? p.accentText : p.ink }]}>{x.label}</Text>
            {on ? <Icon name="check" size={18} color={p.accentText} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Adds `MoneyString`s without a float — see `orders.tsx` for why. */
function sumMoney(values: string[]): string {
  let units = 0n;
  for (const v of values) {
    const [whole = '0', frac = ''] = v.replace('-', '').split('.');
    units += BigInt(whole) * 10_000n + BigInt((frac + '0000').slice(0, 4));
  }
  return `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
}
