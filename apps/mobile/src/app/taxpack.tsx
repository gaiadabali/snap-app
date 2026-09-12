import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type DocumentView, type TaxPack, type TaxPackFile } from '@/api';
import { exportDocumentsCsv, exportLinesCsv, saveTaxPack } from '@/lib/share';
import { Loading } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Card, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatShortDate, space, usePalette } from '@/theme';

/**
 * Everything the accountant needs, in one export.
 *
 * The pack carries the ORIGINAL IMAGES, not just the extracted figures. An
 * extraction is a convenience; under the ATO's rules the acceptable record is
 * a true and clear reproduction of the document itself, and an accountant
 * asked to defend a claim needs the paper, not a spreadsheet of what the paper
 * probably said.
 */

function mb(bytes: number): string {
  return bytes > 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default function TaxPackScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [pack, setPack] = useState<TaxPack | null>(null);
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [file, setFile] = useState<TaxPackFile | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    setBusy(true);
    try {
      setFile(await api().prepareTaxPack());
    } catch (error) {
      Alert.alert(
        'The pack could not be prepared',
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file) return;
    try {
      await saveTaxPack(file);
    } catch (error) {
      Alert.alert(
        'Not available yet',
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    }
  }

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      api().getTaxPack(),
      api().listDocuments('all', 'business'),
    ]);
    setPack(p);
    setDocs(d);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {pack === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>{pack.periodLabel}</HeroLabel>
                <HeroFigure small>{mb(pack.totalBytes)}</HeroFigure>
                <HeroBody>
                  {formatShortDate(pack.fromDate)} to {formatShortDate(pack.toDate)}
                </HeroBody>
              </View>
            </GradientHero>

            <View style={{ gap: space.sm }}>
              <Label>What goes in</Label>
              <Raised style={{ padding: 0 }}>
                {pack.sections.map((s, i) => (
                  <View key={s.label}>
                    {i > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        paddingHorizontal: space.lg,
                        paddingVertical: 13,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Body strong>{s.label}</Body>
                        <Small>{s.detail}</Small>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Figure size="h2">{String(s.count)}</Figure>
                        <Small>{mb(s.bytes)}</Small>
                      </View>
                    </View>
                  </View>
                ))}
              </Raised>
            </View>

            <Card>
              <View style={{ gap: space.xs }}>
                <Label>Why the images are in it</Label>
                <Body>{pack.retentionNote}</Body>
                <Small>
                  Snap Apps keeps the original bytes exactly as captured — never cropped,
                  re-encoded or &ldquo;enhanced&rdquo; — so the copy in this pack is the record,
                  not a picture of one.
                </Small>
              </View>
            </Card>

            {file ? (
              <Card tone="accent">
                <View style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Label style={{ color: p.accent }}>Pack ready</Label>
                    <Chip tone="accent">{mb(file.bytes)}</Chip>
                  </View>
                  <Body>
                    {file.documentCount} document{file.documentCount === 1 ? '' : 's'} with their
                    original images, an index, and your trip log. The link expires — it is a
                    financial year of records, not something to leave sitting in an inbox.
                  </Body>
                  <Button label="Save the pack" onPress={() => void save()} />
                  <Small>Or take just the figures:</Small>
                  <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                    <Chip
                      tone="accent"
                      onPress={() => {
                        const inPeriod = docs.filter(
                          (d) => d.issueDate >= pack.fromDate && d.issueDate <= pack.toDate,
                        );
                        void exportDocumentsCsv(inPeriod, 'tax-pack');
                      }}
                    >
                      Export documents
                    </Chip>
                    <Chip
                      tone="accent"
                      onPress={() => {
                        const inPeriod = docs.filter(
                          (d) => d.issueDate >= pack.fromDate && d.issueDate <= pack.toDate,
                        );
                        void exportLinesCsv(inPeriod, 'tax-pack');
                      }}
                    >
                      Export line items
                    </Chip>
                  </View>
                </View>
              </Card>
            ) : (
              <Button
                label="Prepare the pack"
                busy={busy}
                onPress={() => void prepare()}
              />
            )}

            <Small style={{ textAlign: 'center' }}>
              Documents whose GST credit is at risk are included and flagged, not quietly dropped.
              Your accountant would rather see them.
            </Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
