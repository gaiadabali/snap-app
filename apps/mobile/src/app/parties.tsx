import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { api, type Party } from '@/api';
import { AddButton, Field, Sheet } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAbn, formatAud, space, usePalette } from '@/theme';

export default function PartiesScreen() {
  const p = usePalette();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = params.kind === 'supplier' ? 'supplier' : 'customer';
  const [rows, setRows] = useState<Party[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', abn: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api().listParties(kind).then(setRows);
  }, [kind]);

  const save = useCallback(async () => {
    setError(null);
    try {
      const all = await api().createParty({ ...draft, kind });
      setRows(all.filter((x) => x.kind === kind));
      setAdding(false);
      setDraft({ name: '', abn: '', email: '', phone: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that contact.');
    }
  }, [draft, kind]);

  const all = rows ?? [];
  const owed = all.reduce((a, x) => a + Number(x.openBalance), 0);
  const missingAbn = all.filter((x) => !x.abnValid).length;

  return (
    <Screen>
      <FlatList
        data={all}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>{kind === 'customer' ? 'Owed by customers' : 'Suppliers on file'}</HeroLabel>
                <HeroFigure>
                  {kind === 'customer' ? formatAud(owed.toFixed(2)) : String(all.length)}
                </HeroFigure>
                <HeroBody>
                  {all.length} {kind}
                  {all.length === 1 ? '' : 's'}
                  {missingAbn > 0 ? ` · ${missingAbn} without a valid ABN` : ''}
                </HeroBody>
              </View>
            </GradientHero>

            <AddButton
              label={kind === 'customer' ? 'Add a customer' : 'Add a supplier'}
              onPress={() => {
                setError(null);
                setAdding(true);
              }}
            />
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Raised accent={!item.abnValid ? p.warn : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: item.kind === 'customer' ? '#27AE6030' : '#9B6BF230',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: p.ink }}>
                  {item.name.slice(0, 1)}
                </Text>
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Body strong numberOfLines={1}>
                  {item.name}
                </Body>
                <Small numberOfLines={1}>
                  {item.abn ? `ABN ${formatAbn(item.abn)}` : 'No ABN on file'}
                </Small>
                {!item.abnValid ? (
                  <View style={{ flexDirection: 'row', marginTop: 2 }}>
                    <Chip tone="warn">
                      {kind === 'customer' ? 'Needed over $1,000' : 'Blocks GST credits'}
                    </Chip>
                  </View>
                ) : null}
              </View>

              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                {Number(item.openBalance) > 0 ? (
                  <>
                    <Figure size="h2">{formatAud(item.openBalance)}</Figure>
                    <Small>outstanding</Small>
                  </>
                ) : (
                  <Small>{item.invoiceCount ? 'settled' : '—'}</Small>
                )}
              </View>
            </View>
          </Raised>
        )}
        ListFooterComponent={
          missingAbn > 0 ? (
            <View style={{ paddingTop: space.lg, gap: space.xs }}>
              <Label>Why the ABN matters</Label>
              <Small>
                {kind === 'customer'
                  ? 'A tax invoice for $1,000 or more must show the buyer’s ABN, so you need it on file before you bill them that much.'
                  : 'Without a valid supplier ABN you cannot claim the GST credit on what you bought — and you may have to withhold under the no-ABN rules.'}
              </Small>
            </View>
          ) : null
        }
      />
    
      <Sheet
        open={adding}
        title={kind === 'customer' ? 'Add a customer' : 'Add a supplier'}
        subtitle="An ABN is checked against the ATO checksum before it is saved."
        error={error}
        submitLabel="Add"
        submitDisabled={!draft.name.trim()}
        onClose={() => setAdding(false)}
        onSubmit={save}
      >
        <Field
          label="Name"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          placeholder="Northline Freight Co"
          autoFocus
        />
        <Field
          label="ABN"
          value={draft.abn}
          onChangeText={(abn) => setDraft({ ...draft, abn })}
          keyboardType="number-pad"
          placeholder="51 824 753 556"
          hint="Optional, but required on any tax invoice over $1,000"
        />
        <Field
          label="Email"
          value={draft.email}
          onChangeText={(email) => setDraft({ ...draft, email })}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label="Phone"
          value={draft.phone}
          onChangeText={(phone) => setDraft({ ...draft, phone })}
          keyboardType="phone-pad"
        />
      </Sheet>
    </Screen>
  );
}
