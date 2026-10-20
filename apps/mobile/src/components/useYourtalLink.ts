import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ApiError, api } from '@/api';
import type { LinkLoad } from '@/components/YourtalLinkPanel';
import type { LinkContext } from '@/lib/yourtal-link';

/**
 * The YourTal link, loaded and acted on (`GET / POST / DELETE /v1/yourtal/link`).
 *
 * Reloads whenever the screen using it comes into focus, so a link made on
 * another device, or ended in YourTal, shows up without a restart. A reload
 * that fails keeps what was already on screen: a dropped connection should not
 * replace a linked account's numbers with an error.
 *
 * `link` and `unlink` resolve to whether they worked. A failure is kept as
 * `error`, carrying the server's `error` code (or none, for a network failure)
 * for `linkErrorMessage` to turn into a sentence.
 */
export function useYourtalLink() {
  const [load, setLoad] = useState<LinkLoad>({ kind: 'loading' });
  const [busy, setBusy] = useState<LinkContext | null>(null);
  const [error, setError] = useState<{ context: LinkContext; code: string | null } | null>(null);

  const reload = useCallback(async () => {
    try {
      const status = await api().getYourtalLink();
      setLoad({ kind: 'ready', status });
    } catch {
      setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'error' }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    void reload();
  }, [reload]);

  const run = useCallback(
    async (context: LinkContext, call: () => Promise<unknown>): Promise<boolean> => {
      setBusy(context);
      setError(null);
      try {
        await call();
        await reload();
        return true;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : null;
        setError({ context, code });
        // The server and this screen disagree about whether it is linked.
        if (code === 'already_linked') void reload();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const link = useCallback((code: string) => run('link', () => api().linkYourtal(code)), [run]);
  const unlink = useCallback(() => run('unlink', () => api().unlinkYourtal()), [run]);
  const clearError = useCallback(() => setError(null), []);

  return { load, busy, error, retry, link, unlink, clearError };
}
