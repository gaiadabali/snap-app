/**
 * Per-viewer ad dismissal, persisted in `localStorage`.
 *
 * Split from `HouseAd.tsx` for the same reason `proof-data.ts` is split from
 * `proof.tsx`: the web test suite is logic-only and node-environment (see
 * `vitest.config.ts`), so anything worth a unit test has to be plain
 * TypeScript with no JSX. `parseDismissedIds` / `serializeDismissedIds` are
 * pure and tested directly; `readDismissedIds` / `persistDismissal` are the
 * thin, untested `window.localStorage` wrapper around them.
 *
 * A dismissal is by ad id, not by placement — D25 says "a viewer who
 * dismisses one should not see it again," and the same creative can be
 * eligible on more than one screen (`HouseAdEntry.placements`). Dismissing it
 * on one screen has to mean it stops appearing everywhere.
 */

const STORAGE_KEY = 'snap-house-ad-dismissed';

/** Pure parse. Never throws — anything that isn't a JSON array of strings becomes `[]`. */
export function parseDismissedIds(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string');
}

export function serializeDismissedIds(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/**
 * Reads the dismissed set for this browser. Wrapped in `try/catch` because
 * `localStorage` throws in some private-browsing modes and can legitimately
 * be unavailable — the correct behaviour there is "nothing is dismissed yet,"
 * not a crashed page.
 */
export function readDismissedIds(): Set<string> {
  try {
    return new Set(parseDismissedIds(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    return new Set();
  }
}

/**
 * Adds one id to the dismissed set and writes it back. Silently does nothing
 * on failure — the click still hides the ad for the rest of this page load
 * (the caller updates its own state independently), it just won't have
 * persisted, which is the same "degrade, don't crash" posture as
 * `ThemeToggle`'s `localStorage` write.
 */
export function persistDismissal(id: string): void {
  try {
    const current = readDismissedIds();
    current.add(id);
    window.localStorage.setItem(STORAGE_KEY, serializeDismissedIds([...current]));
  } catch {
    // Private browsing / storage blocked — dismissal only lasts this load.
  }
}
