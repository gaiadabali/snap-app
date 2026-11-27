import type { MailStatus } from '@snap/api-contract';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '@/api';

/**
 * `GET /v1/mail/status`, read once when the component mounts and again on `refresh()`.
 *
 *  - `status` is `null` until the first answer, and when the read failed.
 *  - A 404 means this server has no mail routes (an older server): that is "mail is off", so
 *    `status` becomes `{ available: false }` and nothing is shown, rather than an error.
 *  - Any other failure sets `failed`, so the Mail screen can offer a retry. The menu ignores it
 *    and simply shows no Mail entry.
 */
export function useMailStatus(): {
  status: MailStatus | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (isLive: () => boolean) => {
    setFailed(false);
    try {
      const next = await api().getMailStatus();
      if (isLive()) setStatus(next);
    } catch (e) {
      if (!isLive()) return;
      if (e instanceof ApiError && e.status === 404) {
        setStatus({ available: false, linked: false, mailbox: null, settings: { statements: false, workspaceId: null, alerts: true } });
      } else {
        setFailed(true);
      }
    } finally {
      if (isLive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load(() => true);
  }, [load]);

  return { status, loading, failed, refresh };
}
