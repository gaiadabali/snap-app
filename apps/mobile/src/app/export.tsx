import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type DocumentView } from '@/api';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { PeriodChips, periodRange, type Period } from '@/components/SearchBar';
import {
  Button,
  Figure,
  Label,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Small,
} from '@/components/ui';
import { exportDocumentsCsv, exportLinesCsv } from '@/lib/share';
import { formatAud, radius, space, type, usePalette } from '@/theme';

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
 *
 * What to export is a choice between two outline rows with one primary button
 * under them (the instrument pass, 2026-10-19), rather than two buttons of
 * different weight: the button then names exactly what will leave the phone.
 */
export default function ExportScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [period, setPeriod] = useState<Period>('year');
  const [kind, setKind] = useState<'documents' | 'lines'>('documents');
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

  async function run() {
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
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Export receipts" onBack={() => router.back()} />
        <Text style={[type.body, { color: p.inkMuted }]}>
          Every receipt in the period you choose, with the fields read from it.
        </Text>

        <View style={{ gap: space.sm }}>
          <Label>Period</Label>
          <PeriodChips value={period} onChange={setPeriod} />
        </View>

        <Section label="In this export">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              paddingVertical: space.md,
            }}
          >
            <Label>
              {docs === null
                ? 'Counting…'
                : selected.length === 1
                  ? '1 receipt'
                  : `${selected.length} receipts`}
            </Label>
            <Figure size="h1">{formatAud(total)}</Figure>
          </View>
          <Small>
            A CSV of the fields, plus a line-item CSV if you want the detail. The original photos
            stay in the app.
          </Small>
        </Section>

        <View style={{ gap: space.sm }}>
          <Label>Format</Label>
          <ChoiceRow
            selected={kind === 'documents'}
            title="Receipts"
            detail="One row per receipt, with the fields read from it."
            onPress={() => setKind('documents')}
          />
          <ChoiceRow
            selected={kind === 'lines'}
            title="Line items"
            detail="One row per line on every receipt, for the detail."
            onPress={() => setKind('lines')}
          />
        </View>

        {empty ? (
          <Notice tone="warn" icon="alert">
            Nothing was scanned in this period. Pick a wider one.
          </Notice>
        ) : null}
        {done ? <Notice tone="good" icon="check">{done}</Notice> : null}
        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Button
          label={kind === 'documents' ? 'Export receipts' : 'Export line items'}
          icon="upload"
          busy={busy !== null}
          disabled={selected.length === 0}
          onPress={() => void run()}
        />

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

/** One selectable outline row: ink border and a filled mark when chosen. */
function ChoiceRow({
  selected,
  title,
  detail,
  onPress,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 60,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? p.ink : p.ruleStrong,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: p.ink }]}>{title}</Text>
        <Small>{detail}</Small>
      </View>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: radius.xs,
          borderWidth: 1,
          borderColor: selected ? p.ink : p.ruleStrong,
          backgroundColor: selected ? p.ink : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="check" size={12} color={p.ground} /> : null}
      </View>
    </PressableScale>
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
