import { NextRequest, NextResponse } from 'next/server';
import type { FtrSendStarted } from '@snap/api-contract';

import { ApiError, api } from '@/lib/api/server';
import { ftrSendMessage } from '@/lib/auth/yourtal-errors';
import { FTR_SEND_COOKIE, YOURTAL_FLOW_COOKIE, YOURTAL_FLOW_COOKIE_OPTIONS } from '@/lib/auth/yourtal-flow';
import { loadWorkspace } from '@/lib/panels/workspace';

/**
 * Starts a send to Free Tax Returns (group 4.8.a). A same-origin POST, so only
 * our own page can start one: it asks the API, sets the YourTal flow cookie and
 * the `snap_ftr_send` marker (the callback reads both), and answers `{ url }` for
 * the page to go to. Errors come back as a code with a fixed message.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Same-origin only: the Origin's host must be the one the browser used.
  const origin = request.headers.get('origin');
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0]?.trim();
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && (!host || !origin.endsWith(`//${host}`)))) {
    return NextResponse.json({ message: ftrSendMessage(null) }, { status: 403 });
  }

  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return NextResponse.json({ error: 'not_personal', message: ftrSendMessage('not_personal') }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { financialYear?: unknown } | null;
  const financialYear = typeof body?.financialYear === 'string' ? body.financialYear : undefined;

  try {
    const started = await api<FtrSendStarted>('/v1/ftr-sends', {
      method: 'POST',
      body: { client: 'web', returnTo: '/app/categories', locale: 'en-AU', ...(financialYear ? { financialYear } : {}) },
      workspaceId: workspace.id,
    });
    const response = NextResponse.json({ url: started.url });
    response.cookies.set(YOURTAL_FLOW_COOKIE, started.flowId, YOURTAL_FLOW_COOKIE_OPTIONS);
    response.cookies.set(FTR_SEND_COOKIE, '1', YOURTAL_FLOW_COOKIE_OPTIONS);
    response.headers.set('cache-control', 'private, no-store');
    return response;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const code = (e.body as { error?: unknown } | undefined)?.error;
    const known = typeof code === 'string' ? code : undefined;
    return NextResponse.json({ error: known, message: ftrSendMessage(known) }, { status: e.status });
  }
}
