import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type MileageSummary, type Trip } from '@/api';
import { AddButton, Empty, Field, Loading, Sheet, StatRow, Toggle } from '@/components/form';
import { TripTracker } from '@/components/TripTracker';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Card, Chip, Divider, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

/**
 * The trip log behind a D1 car claim.
 *
 * Two methods exist and the app has to be honest about which one is better
 * here. Cents per kilometre needs no receipts but stops at 5,000 business
 * kilometres per car per year; past that a logbook claims more. This screen
 * shows the cents-per-km figure, and says plainly once the logbook overtakes
 * it — an app that quietly caps the claim and never mentions the alternative
 * is costing its user money.
 *
 * The rate comes from the tax engine's rate set, so it moves when the ATO
 * moves it and not when someone remembers.
 */

const blank = {
  date: new Date().toISOString().slice(0, 10),
  fromPlace: '',
  toPlace: '',
  km: '',
  purpose: '',
  workRelated: true,
};

export default function MileageScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MileageSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api().getMileage());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const valid =
    draft.fromPlace.trim() !== '' && draft.toPlace.trim() !== '' && Number(draft.km) > 0;

  async function save() {
    setError(null);
    try {
      const next = await api().addTrip({
        date: draft.date,
        fromPlace: draft.fromPlace.trim(),
        toPlace: draft.toPlace.trim(),
        km: Number(draft.km),
        purpose: draft.purpose.trim() || 'Work travel',
        workRelated: draft.workRelated,
      });
      setData(next);
      setAdding(false);
      setDraft(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that trip.');
    }
  }

  function remove(trip: Trip) {
    void api().deleteTrip(trip.id).then(setData);
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
        {data === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Claimable at {data.centsPerKmRate * 100}c per km</HeroLabel>
                <HeroFigure>{formatAud(data.claimAtCentsPerKm)}</HeroFigure>
                <HeroBody>
                  {data.workKm.toLocaleString('en-AU')} work km of{' '}
                  {data.totalKm.toLocaleString('en-AU')} logged
                </HeroBody>
              </View>
            </GradientHero>

            {data.overCentsPerKmCap ? (
              <Card tone="risk">
                <View style={{ gap: space.xs }}>
                  <Label style={{ color: p.risk }}>Past the cents-per-km ceiling</Label>
                  <Body>
                    Cents per kilometre stops at {data.centsPerKmCapKm.toLocaleString('en-AU')} km
                    per car per year, and you have logged{' '}
                    {data.workKm.toLocaleString('en-AU')}. A logbook claim at your{' '}
                    {data.logbookPercent}% business use would be worth more — keep the log going
                    and the tax screen will use whichever is higher.
                  </Body>
                </View>
              </Card>
            ) : (
              <Raised>
                <StatRow
                  stats={[
                    {
                      label: 'Room left',
                      value: `${(data.centsPerKmCapKm - data.workKm).toLocaleString('en-AU')} km`,
                      hint: `Before the ${data.centsPerKmCapKm.toLocaleString('en-AU')} km cap`,
                    },
                    {
                      label: 'Logbook use',
                      value: `${data.logbookPercent}%`,
                      hint: 'From your current logbook',
                    },
                  ]}
                />
              </Raised>
            )}

            {/* GPS first, typing second: the app measuring the distance is
                the whole point, and a driver who has just parked should not
                have to remember an odometer reading. */}
            <TripTracker onSaved={() => void load()} />

            <AddButton
              label="Log a trip by hand"
              onPress={() => {
                setDraft({ ...blank, date: new Date().toISOString().slice(0, 10) });
                setError(null);
                setAdding(true);
              }}
            />

            <View style={{ gap: space.sm }}>
              <Label>Trips</Label>
              {data.trips.length === 0 ? (
                <Empty
                  title="No trips logged"
                  detail="Log each work trip as you make it — a reconstruction at tax time is not a logbook."
                />
              ) : (
                <Raised style={{ padding: 0 }}>
                  {data.trips.map((t, i) => (
                    <View key={t.id}>
                      {i > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 12,
                          opacity: t.workRelated ? 1 : 0.55,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong numberOfLines={1}>
                            {t.fromPlace} → {t.toPlace}
                          </Body>
                          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                            <Small numberOfLines={1} style={{ flexShrink: 1 }}>
                              {formatShortDate(t.date)} · {t.purpose}
                            </Small>
                            {!t.workRelated ? <Chip>Private</Chip> : null}
                          </View>
                        </View>
                        <Body strong>{t.km} km</Body>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete the trip from ${t.fromPlace} to ${t.toPlace}`}
                          hitSlop={8}
                          onPress={() => remove(t)}
                        >
                          <Text style={{ color: p.inkFaint, fontSize: 18 }}>×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </Raised>
              )}
            </View>

            <Small style={{ textAlign: 'center' }}>
              A private trip is logged but never claimed. The commute between home and a regular
              workplace is private travel under ATO rules, even in a work vehicle.
            </Small>
          </>
        )}
      </ScrollView>

      <Sheet
        open={adding}
        title="Log a trip"
        error={error}
        submitLabel="Save trip"
        submitDisabled={!valid}
        onClose={() => setAdding(false)}
        onSubmit={save}
      >
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 2 }}>
            <Field
              label="From"
              value={draft.fromPlace}
              onChangeText={(fromPlace) => setDraft({ ...draft, fromPlace })}
              placeholder="Goulburn depot"
              autoFocus
            />
          </View>
          <View style={{ flex: 2 }}>
            <Field
              label="To"
              value={draft.toPlace}
              onChangeText={(toPlace) => setDraft({ ...draft, toPlace })}
              placeholder="Sydney markets"
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Distance"
              value={draft.km}
              onChangeText={(km) => setDraft({ ...draft, km })}
              keyboardType="decimal-pad"
              hint="km"
            />
          </View>
          <View style={{ flex: 2 }}>
            <Field
              label="Date"
              value={draft.date}
              onChangeText={(date) => setDraft({ ...draft, date })}
              placeholder="2026-09-10"
            />
          </View>
        </View>
        <Field
          label="Purpose"
          value={draft.purpose}
          onChangeText={(purpose) => setDraft({ ...draft, purpose })}
          placeholder="Pallet delivery"
        />
        <Toggle
          label="Work related"
          hint="Turn off for private travel, including the commute"
          value={draft.workRelated}
          onChange={(workRelated) => setDraft({ ...draft, workRelated })}
        />
      </Sheet>
    </Screen>
  );
}
