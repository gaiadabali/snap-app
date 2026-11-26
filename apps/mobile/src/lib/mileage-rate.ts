/**
 * The cents-per-km rate as shown to a person: "88¢/km".
 *
 * The API carries the rate in DOLLARS per km (`0.88`, the tax engine's
 * `centsPerKmRate`, despite its name), so printing it next to "¢" gave
 * "0.88¢/km". Rounded to a whole cent unless the rate has a fractional cent.
 */
export function formatCentsPerKm(dollarsPerKm: number): string {
  const cents = Math.round(dollarsPerKm * 10000) / 100;
  return `${cents}¢/km`;
}
