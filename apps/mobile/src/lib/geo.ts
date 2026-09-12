/**
 * Distance between GPS fixes, for the trip log.
 *
 * Pure and unit-tested, because a logbook is a tax record: the ATO can ask a
 * taxpayer to substantiate a car claim, and "the app said so" is not an
 * answer if the app's arithmetic is wrong. Everything here is deliberately
 * free of expo-location so it can be tested in Node.
 */

export type Fix = {
  latitude: number;
  longitude: number;
  /** Metres. Used to reject fixes too vague to measure with. */
  accuracy: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
};

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMetres(a: Fix, b: Fix): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Should this fix be counted?
 *
 * Two filters, both of which matter on a real drive:
 *
 *  - A fix with poor accuracy is discarded. A 500 m error added to every
 *    sample would inflate a logbook, and inflating a tax claim is the one
 *    direction of error that must not happen by accident.
 *  - A step shorter than the accuracy of the fixes that produced it is noise,
 *    not movement. Parked at a truck stop, a phone will otherwise wander
 *    hundreds of metres over an hour and log a trip nobody drove.
 */
export function shouldCount(
  previous: Fix,
  next: Fix,
  options: { maxAccuracyM?: number } = {},
): { count: boolean; metres: number; reason?: string } {
  const maxAccuracy = options.maxAccuracyM ?? 50;
  if (next.accuracy != null && next.accuracy > maxAccuracy) {
    return { count: false, metres: 0, reason: 'accuracy' };
  }
  const metres = haversineMetres(previous, next);
  const noiseFloor = Math.max(previous.accuracy ?? 0, next.accuracy ?? 0, 10);
  if (metres < noiseFloor) return { count: false, metres: 0, reason: 'noise' };

  // Implausible speed: a jump between towers, or a fix from a different city.
  const seconds = Math.max(1, (next.timestamp - previous.timestamp) / 1000);
  const kmh = (metres / seconds) * 3.6;
  if (kmh > 220) return { count: false, metres: 0, reason: 'implausible' };

  return { count: true, metres };
}

/** Running total over a sequence of fixes, applying the filters above. */
export function tripDistanceMetres(fixes: Fix[]): number {
  let total = 0;
  let last: Fix | null = null;
  for (const fix of fixes) {
    if (last) {
      const step = shouldCount(last, fix);
      if (step.count) {
        total += step.metres;
        last = fix;
      }
      // A rejected fix is not adopted as the new baseline: doing so would let
      // noise ratchet the position forward without ever counting distance.
      continue;
    }
    last = fix;
  }
  return total;
}

/**
 * Kilometres, to one decimal.
 *
 * Rounded DOWN, not to nearest. A logbook that rounds up on every trip
 * over-states the claim across a year, and the taxpayer carries that risk.
 */
export function metresToKm(metres: number): number {
  return Math.floor(metres / 100) / 10;
}
