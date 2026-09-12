import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { api, type Trip } from '@/api';
import { Field, Sheet, Toggle } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { Body, Button, Card, Label, Small } from '@/components/ui';
import { metresToKm, shouldCount, type Fix } from '@/lib/geo';
import { space, usePalette } from '@/theme';

/**
 * Recording a trip as it happens.
 *
 * Foreground only, and the screen says so. Background location is a separate
 * permission, a separate app-store review, and a battery cost the user did not
 * ask for; a driver who wants automatic tracking can leave the screen open on
 * a cradle, and anyone else types the distance in as before.
 *
 * The measurement lives in `lib/geo.ts` and is unit tested. A logbook is a tax
 * record the ATO can ask a taxpayer to substantiate, and the filters that
 * matter — discarding vague fixes, ignoring drift while parked — all bias the
 * claim if they are wrong.
 */

type State = 'idle' | 'asking' | 'tracking' | 'denied' | 'unavailable';

export function TripTracker({ onSaved }: { onSaved: () => void }) {
  const p = usePalette();
  const [state, setState] = useState<State>('idle');
  const [metres, setMetres] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [rejected, setRejected] = useState(0);
  const [pendingSave, setPendingSave] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '', purpose: '', work: true });
  const [error, setError] = useState<string | null>(null);

  const watcher = useRef<Location.LocationSubscription | null>(null);
  const last = useRef<Fix | null>(null);

  const stopWatching = useCallback(() => {
    watcher.current?.remove();
    watcher.current = null;
    last.current = null;
  }, []);

  // A watcher left running after the screen closes drains the battery all day.
  useEffect(() => stopWatching, [stopWatching]);

  async function start() {
    setError(null);
    if (Platform.OS === 'web') {
      setState('unavailable');
      return;
    }
    setState('asking');
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        setState('denied');
        return;
      }
    } catch {
      setState('unavailable');
      return;
    }

    setMetres(0);
    setRejected(0);
    setStartedAt(Date.now());
    setState('tracking');

    watcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        // Every 25 m or 5 s. Tighter measures GPS noise; looser cuts the
        // corners off a winding road and under-reports the distance.
        distanceInterval: 25,
        timeInterval: 5_000,
      },
      (position) => {
        const fix: Fix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          timestamp: position.timestamp,
        };
        const previous = last.current;
        if (!previous) {
          last.current = fix;
          return;
        }
        const step = shouldCount(previous, fix);
        if (step.count) {
          setMetres((m) => m + step.metres);
          last.current = fix;
        } else {
          // Deliberately does NOT adopt the rejected fix: letting noise become
          // the baseline ratchets the position forward for free.
          setRejected((n) => n + 1);
        }
      },
    );
  }

  const km = metresToKm(metres);
  const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60_000)) : 0;

  async function save() {
    setError(null);
    try {
      await api().addTrip({
        date: new Date().toISOString().slice(0, 10),
        fromPlace: draft.from.trim() || 'Start',
        toPlace: draft.to.trim() || 'Finish',
        km,
        purpose: draft.purpose.trim() || 'Work travel',
        workRelated: draft.work,
      });
      setPendingSave(false);
      setMetres(0);
      setStartedAt(null);
      setDraft({ from: '', to: '', purpose: '', work: true });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that trip.');
    }
  }

  return (
    <>
      {state === 'tracking' ? (
        <>
          <GradientHero>
            <View style={{ gap: space.xs }}>
              <HeroLabel>Recording · foreground only</HeroLabel>
              <HeroFigure>{km.toFixed(1)} km</HeroFigure>
              <HeroBody>
                {minutes} min{minutes === 1 ? '' : 's'}
                {rejected > 0
                  ? ` · ${rejected} vague fix${rejected === 1 ? '' : 'es'} ignored`
                  : ''}
              </HeroBody>
            </View>
          </GradientHero>

          <Card>
            <View style={{ gap: space.xs }}>
              <Label>Keep this screen open</Label>
              <Body>
                Tracking stops if the app goes to the background. Leave the phone on its cradle, or
                type the distance in afterwards.
              </Body>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Discard"
              tone="outline"
              onPress={() => {
                stopWatching();
                setState('idle');
                setMetres(0);
              }}
              style={{ flex: 1 }}
            />
            <Button
              label={`Finish · ${km.toFixed(1)} km`}
              onPress={() => {
                stopWatching();
                setState('idle');
                // Straight into the details sheet with the distance already
                // measured — the one part nobody can reconstruct later.
                setPendingSave(true);
              }}
              disabled={km <= 0}
              style={{ flex: 2 }}
            />
          </View>
        </>
      ) : (
        <>
          {state === 'denied' ? (
            <Card tone="risk">
              <View style={{ gap: space.xs }}>
                <Label style={{ color: p.risk }}>Location permission declined</Label>
                <Body>
                  Without it the app cannot measure a trip. Logging kilometres by hand is just as
                  valid a logbook entry.
                </Body>
              </View>
            </Card>
          ) : null}

          {state === 'unavailable' ? (
            <Card>
              <View style={{ gap: space.xs }}>
                <Label>Not available here</Label>
                <Body>
                  Trip recording needs a phone&rsquo;s GPS. On the web build, log the distance by
                  hand.
                </Body>
              </View>
            </Card>
          ) : null}

          <Button
            label={state === 'asking' ? 'Asking permission…' : 'Record a trip with GPS'}
            onPress={() => void start()}
            disabled={state === 'asking'}
          />
        </>
      )}

      <Sheet
        open={pendingSave}
        title="Save this trip"
        subtitle={`${km.toFixed(1)} km measured`}
        error={error}
        submitLabel="Save trip"
        onClose={() => setPendingSave(false)}
        onSubmit={save}
      >
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="From"
              value={draft.from}
              onChangeText={(from) => setDraft({ ...draft, from })}
              placeholder="Depot"
              autoFocus
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="To"
              value={draft.to}
              onChangeText={(to) => setDraft({ ...draft, to })}
              placeholder="Sydney markets"
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
          hint="Off for private travel, including the commute"
          value={draft.work}
          onChange={(work) => setDraft({ ...draft, work })}
        />
        <Small>
          Measured from GPS and rounded down to {km.toFixed(1)} km — never up, because rounding up
          on every trip over-states a year&rsquo;s claim. Edit it later if the odometer disagrees.
        </Small>
      </Sheet>
    </>
  );
}
