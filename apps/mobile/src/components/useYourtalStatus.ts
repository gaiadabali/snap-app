import type { YourtalLinkStatus } from '@snap/api-contract';
import { useEffect, useState } from 'react';

import { api } from '@/api';

/**
 * The YourTal link status, read once when the component mounts.
 *
 * For the places that only decide whether to show an entry (menu, home,
 * profile, plan) and need no navigation context, unlike `useYourtalLink`.
 * `null` until it loads and whenever the request fails, so a screen shows
 * nothing about YourTal rather than a guess.
 */
export function useYourtalStatus(): YourtalLinkStatus | null {
  const [status, setStatus] = useState<YourtalLinkStatus | null>(null);
  useEffect(() => {
    let live = true;
    api()
      .getYourtalLink()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return status;
}
