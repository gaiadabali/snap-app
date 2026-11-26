import type { AvailableTaxRules } from '@/api';

/**
 * The country to pre-select in the picker, from the catalogue the server sent.
 *
 * The phone's own region decides when it names a country the catalogue has
 * (an Indonesian phone opens on Indonesia); otherwise Australia, the market
 * this app was built for; otherwise the first option. Always a suggestion —
 * the person can change it, and nothing is installed until onboarding sends
 * their choice.
 *
 * `region` is injectable for tests. In the app it comes from the runtime's
 * `Intl` locale (`en-AU` -> `AU`), which says nothing on some devices; then
 * Australia it is.
 */
export function defaultCountry(
  options: AvailableTaxRules[],
  region: string | null = deviceRegion(),
): AvailableTaxRules | null {
  const byRegion = region ? options.find((o) => o.country === region.toUpperCase()) : undefined;
  return byRegion ?? options.find((o) => o.country === 'AU') ?? options[0] ?? null;
}

/** The ISO 3166 region of the device locale, or null when it has none. */
export function deviceRegion(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const region = locale.split(/[-_]/).find((part, i) => i > 0 && /^[A-Za-z]{2}$/.test(part));
    return region ? region.toUpperCase() : null;
  } catch {
    return null;
  }
}
