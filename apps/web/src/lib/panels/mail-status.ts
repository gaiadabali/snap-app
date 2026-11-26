import 'server-only';

import { cache } from 'react';

import { api, ApiError } from '@/lib/api/server';
import { requireSession } from './session';
import { upstreamCode } from './mail-bff';
import type { MailGate, MailStatus } from './mail-types';

/**
 * Whether this person has mail, and in what state (`GET /v1/mail/status`).
 *
 * The result is a gate, not just data, so the layout and the nav agree:
 *
 *  - `unavailable`: the switch is off (`available: false`), or the API has no mail
 *    routes yet (404). Mail is hidden everywhere.
 *  - `unlinked`: not signed in with YourTal. The status route answers 200 with
 *    `linked: false` (only the other `/v1/mail/*` routes answer 409
 *    `yourtal_not_linked`), and the session may already say so. Mail shows the "Sign in
 *    with YourTal" prompt, not an error.
 *  - `error`: the read failed. The page offers a retry; the nav stays out of the way.
 *
 * Memoised per request with React's `cache()`, like `requireSession`.
 */
export const getMailGate = cache(async (): Promise<MailGate> => {
  const { yourtalLinked } = await requireSession();
  // The session already knows: no need to ask the mail endpoint.
  if (yourtalLinked === false) return { kind: 'unlinked' };
  try {
    const status = await api<MailStatus>('/v1/mail/status');
    if (!status.available) return { kind: 'unavailable' };
    if (!status.linked) return { kind: 'unlinked' };
    return { kind: 'ready', status };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return { kind: 'unavailable' };
      // Defensive: the contract says status answers 200 + linked:false, but a 409 means the same.
      if (error.status === 409 && upstreamCode(error.body) === 'yourtal_not_linked') return { kind: 'unlinked' };
    }
    return { kind: 'error' };
  }
});
