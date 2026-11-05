import { createHash, timingSafeEqual } from 'node:crypto';

import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { validateDeductionBundleJson } from '@snap/api-contract/deduction-bundle';
import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { RateLimiter } from '../auth/rate-limit.js';
import { identityFromClaims, refusal, sameOriginPath } from '../auth/yourtal-signin/claims.js';
import { isClientConfigured, redeemCode, startAuthorization } from '../auth/yourtal-signin/oidc.js';
import { openFlow, setFlowFtrSend, takeFtrSendFlow } from '../auth/yourtal-signin/repo.js';
import { yourtalSignInSettings, type YourTalClientKind } from '../auth/yourtal-signin/settings.js';
import { getDb } from '../db.js';
import { listMembers, readTenant } from '../repo.js';
import { isTeen, isTeenSpace } from '../teens/teens.repo.js';
import { oidcApiCall, oidcClientConfigured } from '../yourtal/oidc-client-api.js';
import { sydneyToday } from '../summaries/summaries.controller.js';
import { buildDeductionBundle } from './deduction-bundle.js';
import { parseFy } from './deduction-bundle.controller.js';
import { fyLabel } from './deduction-totals.js';
import { deductionTotals } from './deductions.repo.js';
import { ftrTransferConfigured, postBundle } from './ftr-client.js';

/**
 * Send a deduction bundle to Free Tax Returns directly (group 4.8.a; yourtal
 * docs/30 §3, §6). `startSend` is step 1, `finishSend` step 3.
 *
 * The bundle is built once at the start and stored as the exact text whose
 * SHA-256 YourTal's assertion is bound to (0049: held only while the send is
 * open, an hour at most). The finish posts those stored bytes.
 *
 * Rules the S1 review set for the finish (4.8-s1-review.md findings 4, 6, 8):
 *  - the send is loaded as `app_rw` under the SESSION's workspace and must
 *    belong to the session's user: `flow.ftr_send_id` alone is never trusted
 *    (app_identity can link a flow to any workspace's send);
 *  - a send is closed only with `WHERE status = 'started'`, row count checked;
 *  - a send over an hour old is refused whether or not the sweep has run. "Old" is 59 minutes: a
 *    send that passes the check can still take ~40 s to finish, and the 5-minute sweep must not
 *    expire (and so mis-record) a row FTR has already accepted.
 *
 * Nothing YourTal or FTR issues (code, tokens, the assertion) is logged or stored.
 */

const logger = new Logger('ftr-send');

/** Five sends per person per 15 minutes (docs/30 §6). */
const startsPerUser = new RateLimiter(5, 15 * 60 * 1000);
const finishesPerUser = new RateLimiter(30, 15 * 60 * 1000);

/** Every refusal of the two endpoints, with its status and the words a person sees. */
const SEND_REFUSALS = {
  not_configured: [HttpStatus.NOT_IMPLEMENTED, 'Sending to Free Tax Returns isn’t available yet.'],
  not_personal: [HttpStatus.FORBIDDEN, 'Deductions are sent from a personal workspace.'],
  not_owner: [HttpStatus.FORBIDDEN, 'Only the owner of a personal workspace can send its deductions.'],
  region_not_supported: [HttpStatus.FORBIDDEN, 'Free Tax Returns is for adults in Australia.'],
  teen_space: [HttpStatus.FORBIDDEN, 'Free Tax Returns is for adults in Australia.'],
  yourtal_sign_in_required: [HttpStatus.FORBIDDEN, 'Sign in with YourTal first, then send again.'],
  impersonated: [HttpStatus.FORBIDDEN, 'This needs your own signed-in session.'],
  rate_limited: [HttpStatus.TOO_MANY_REQUESTS, 'Too many attempts. Try again in a few minutes.'],
  nothing_to_send: [HttpStatus.UNPROCESSABLE_ENTITY, 'There are no deductions to send for that year.'],
  invalid_bundle: [HttpStatus.UNPROCESSABLE_ENTITY, 'These deductions can’t be sent as a file Free Tax Returns accepts.'],
  invalid_flow: [HttpStatus.BAD_REQUEST, 'This send has expired or was already used. Please start again.'],
  send_expired: [HttpStatus.BAD_REQUEST, 'This send has expired. Please start again.'],
  yourtal_failed: [HttpStatus.UNAUTHORIZED, 'We couldn’t confirm your sign-in with YourTal. Nothing was sent.'],
  yourtal_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'YourTal isn’t answering right now. Nothing was sent.'],
  wrong_account: [
    HttpStatus.FORBIDDEN,
    'This was confirmed with another YourTal account. Switch back to the one you use in SnapApp. Nothing was sent.',
  ],
  not_allowed: [HttpStatus.FORBIDDEN, 'Free Tax Returns is for adults in Australia. Nothing was sent.'],
  not_approved: [HttpStatus.CONFLICT, 'The send wasn’t confirmed at YourTal. Nothing was sent.'],
  send_refused: [HttpStatus.CONFLICT, 'YourTal wouldn’t send this. Nothing was sent.'],
  ftr_refused: [HttpStatus.UNPROCESSABLE_ENTITY, 'Free Tax Returns didn’t accept the file. Nothing was sent.'],
  ftr_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'Free Tax Returns isn’t answering right now. Nothing was sent.'],
  internal: [HttpStatus.INTERNAL_SERVER_ERROR, 'Something went wrong. Nothing was sent.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type SendRefusalCode = keyof typeof SEND_REFUSALS;

// The finish also surfaces the sign-in module's refusals from redeeming the code and reading the ID
// token (auth/yourtal-signin/claims.ts): yourtal_failed, yourtal_unavailable, invalid_flow,
// region_not_supported, email_unverified, not_configured. Listed in the contract's FtrSendErrorCode.

/** `{ error, message }` like the sign-in; `reason` is FTR's own fixed `err` code on `ftr_refused`. */
export function sendRefusal(code: SendRefusalCode, reason?: string): HttpException {
  const [status, message] = SEND_REFUSALS[code];
  return new HttpException({ error: code, message, ...(reason ? { reason } : {}) }, status);
}

/** What a closed row's `error` column holds: a fixed code, never free text (the column caps it at 100). */
function storedCode(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      const reason = 'reason' in body && typeof body.reason === 'string' ? `:${body.reason}` : '';
      return `${body.error}${reason}`.slice(0, 100);
    }
  }
  return 'internal';
}

type Who = { userId: string };

// ── Eligibility ──────────────────────────────────────────────────────────────

/** Whether this person, in this workspace, may use direct send now; the first refusal otherwise. */
export async function sendEligibility(
  user: Who,
  tenantId: string,
  impersonated: boolean,
): Promise<{ ok: true; sub: string; occupation: string | null } | { ok: false; code: SendRefusalCode }> {
  if (!ftrTransferConfigured() || !oidcClientConfigured()) return { ok: false, code: 'not_configured' };
  const clients = yourtalSignInSettings();
  if (!clients?.web && !clients?.mobile) return { ok: false, code: 'not_configured' };
  if (impersonated) return { ok: false, code: 'impersonated' };

  const tenant = await readTenant(user.userId, tenantId);
  if (tenant?.kind !== 'personal') return { ok: false, code: 'not_personal' };
  // Totals cover the whole workspace, so only its owner may send them (docs/30 D2).
  const role = (await listMembers(user.userId, tenantId)).find((m) => m.user_id === user.userId)?.role;
  if (role !== 'owner') return { ok: false, code: 'not_owner' };
  if (tenant.country !== 'AU') return { ok: false, code: 'region_not_supported' };
  if ((await isTeenSpace(user.userId, tenantId)) || (await isTeen(user.userId))) return { ok: false, code: 'teen_space' };

  const subject = await withTenantAs(getDb(), user.userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ subject: string }>(sql`select subject from users where id = current_user_id()`);
    return rows[0]?.subject ?? '';
  });
  if (!subject.startsWith('yourtal|') || subject.length === 'yourtal|'.length) {
    return { ok: false, code: 'yourtal_sign_in_required' };
  }
  return { ok: true, sub: subject.slice('yourtal|'.length), occupation: tenant.occupation_profile_id };
}

// ── The send row (as app_rw, under the workspace) ────────────────────────────

/** Close an open send. True when this call closed it; false when it was already closed (the row count). */
async function closeSend(
  user: Who,
  tenantId: string,
  sendId: string,
  to: { status: 'sent'; importId: string } | { status: 'cancelled' | 'failed' | 'expired'; error: string },
): Promise<boolean> {
  const error = to.status === 'sent' ? null : to.error;
  const importId = to.status === 'sent' ? to.importId : null;
  return withTenantAs(getDb(), user.userId, tenantId, async (tx) => {
    const { rows } = await tx.execute(sql`
      update ftr_sends
         set status = ${to.status}, error = ${error}, ftr_import_id = ${importId}, bundle = null, finished_at = now()
       where id = ${sendId}::uuid and status = 'started'
      returning id
    `);
    return rows.length === 1;
  });
}

type SendRow = {
  user_id: string;
  status: string;
  financial_year: string;
  line_count: number;
  bundle: string | null;
  bundle_sha256: string;
  yourtal_transfer_id: string | null;
  stale: boolean;
  subject: string;
};

/** The send under the session's workspace and user (RLS plus the user check); null otherwise. */
async function loadSend(user: Who, tenantId: string, sendId: string): Promise<SendRow | null> {
  const row = await withTenantAs(getDb(), user.userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<SendRow>(sql`
      select s.user_id, s.status, s.financial_year, s.line_count, s.bundle, s.bundle_sha256::text as bundle_sha256,
             s.yourtal_transfer_id, s.created_at < now() - interval '59 minutes' as stale,
             (select subject from users where id = current_user_id()) as subject
        from ftr_sends s
       where s.id = ${sendId}::uuid
    `);
    return rows[0] ?? null;
  });
  return row && row.user_id === user.userId ? row : null;
}

// ── YourTal's transfer API (scope app_transfers) ─────────────────────────────

const SCOPE = 'app_transfers';
const PATH = '/api/oidc-clients/transfers';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function createTransfer(
  sendId: string,
  input: { fromSub: string; financialYear: string; bundleSha256: string; lineCount: number },
): Promise<string> {
  let answer;
  try {
    // The send id is the idempotency key: a retried create is the same transfer.
    answer = await oidcApiCall(SCOPE, 'POST', PATH, { ...input, to: 'ftr' }, sendId);
  } catch {
    throw sendRefusal('yourtal_unavailable');
  }
  if (!answer || answer.status >= 500 || answer.status === 401 || answer.status === 429) throw sendRefusal('yourtal_unavailable');
  const id = answer.body.transferId;
  if ((answer.status === 201 || answer.status === 200) && typeof id === 'string' && UUID.test(id)) return id.toLowerCase();
  throw sendRefusal('send_refused');
}

/** The assertion for an approved transfer. Never logged, decoded or stored: handed to FTR and dropped. */
async function fetchAssertion(transferId: string, fromSub: string): Promise<string> {
  let answer;
  try {
    answer = await oidcApiCall(SCOPE, 'POST', `${PATH}/${encodeURIComponent(transferId)}/assertion`, { fromSub });
  } catch {
    throw sendRefusal('yourtal_unavailable');
  }
  if (!answer || answer.status >= 500 || answer.status === 401 || answer.status === 429) throw sendRefusal('yourtal_unavailable');
  const assertion = answer.body.assertion;
  if (answer.status === 200 && typeof assertion === 'string' && assertion.length > 0) return assertion;
  if (answer.status === 409 && answer.body.code === 'not_approved') throw sendRefusal('not_approved');
  if (answer.status === 409 && answer.body.code === 'not_allowed') throw sendRefusal('not_allowed');
  throw sendRefusal('send_refused');
}

// ── Step 1: start ────────────────────────────────────────────────────────────

export type StartSendInput = {
  client: YourTalClientKind;
  financialYear?: string;
  returnTo?: string;
  locale: 'en-AU' | 'id-ID';
};

export type StartedSend = { url: string; flowId: string; sendId: string; expiresAt: string };

export async function startSend(
  user: Who,
  tenantId: string,
  impersonated: boolean,
  input: StartSendInput,
): Promise<StartedSend> {
  const eligible = await sendEligibility(user, tenantId, impersonated);
  if (!eligible.ok) throw sendRefusal(eligible.code);
  if (!isClientConfigured(input.client)) throw sendRefusal('not_configured');

  const fyStart = parseFy(input.financialYear, sydneyToday());
  if (fyStart === null) throw new BadRequestException('`financialYear` must be a financial year we support, like 2025-26.');
  let returnTo: string | null = null;
  if (input.returnTo) {
    returnTo = sameOriginPath(input.returnTo);
    if (!returnTo) throw refusal('invalid_return_to');
  }
  if (!(await startsPerUser.consume(`ftr-send-start:${user.userId}`))) throw sendRefusal('rate_limited');

  const totals = await deductionTotals(user.userId, tenantId, fyStart);
  const bundle = buildDeductionBundle(totals, { generatedAt: new Date(), occupation: eligible.occupation });
  const text = JSON.stringify(bundle);
  if (!validateDeductionBundleJson(text).ok) throw sendRefusal('invalid_bundle');
  if (bundle.lines.length === 0 && bundle.workKilometres === undefined) throw sendRefusal('nothing_to_send');
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const financialYear = fyLabel(fyStart);

  const sendId = await withTenantAs(getDb(), user.userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, bundle)
      values (current_tenant_id(), current_user_id(), ${financialYear}, ${bundle.lines.length}, ${sha}, ${text})
      returning id
    `);
    return rows[0]!.id;
  });

  // From here a failure closes the send: nothing may sit open holding the bytes.
  try {
    const transferId = await createTransfer(sendId, {
      fromSub: eligible.sub,
      financialYear,
      bundleSha256: sha,
      lineCount: bundle.lines.length,
    });
    await withTenantAs(getDb(), user.userId, tenantId, (tx) =>
      tx.execute(sql`update ftr_sends set yourtal_transfer_id = ${transferId} where id = ${sendId}::uuid and status = 'started'`),
    );
    const started = await startAuthorization(input.client, {
      signUp: false,
      locale: input.locale,
      transfer: transferId,
    });
    const flow = await openFlow({
      client: input.client,
      state: started.state,
      nonce: started.nonce,
      codeVerifier: started.codeVerifier,
      returnTo,
      signUp: false,
    });
    if (!(await setFlowFtrSend(flow.flowId, sendId))) throw sendRefusal('invalid_flow');
    return { url: started.url, flowId: flow.flowId, sendId, expiresAt: flow.expiresAt.toISOString() };
  } catch (error) {
    await closeSend(user, tenantId, sendId, { status: 'failed', error: storedCode(error) }).catch(() => undefined);
    throw error;
  }
}

// ── Step 3: finish ───────────────────────────────────────────────────────────

export type FinishSendInput = { flowId: string; state: string; code?: string; iss?: string; error?: string };

export type FinishedSend =
  | { status: 'sent'; importId: string; financialYear: string; lineCount: number; returnTo: string | null }
  | { status: 'cancelled'; returnTo: string | null };

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.byteLength === y.byteLength && timingSafeEqual(x, y);
}

export async function finishSend(
  user: Who,
  tenantId: string,
  impersonated: boolean,
  input: FinishSendInput,
): Promise<FinishedSend> {
  // Before the flow is taken, so staff acting as a person burn nothing of theirs.
  if (impersonated) throw sendRefusal('impersonated');
  if (!(await finishesPerUser.consume(`ftr-send-finish:${user.userId}`))) throw sendRefusal('rate_limited');

  // Taken first, so a wrong state or a replay burns the flow; a flow with no send is not taken at all.
  const flow = await takeFtrSendFlow(input.flowId);
  if (!flow) throw sendRefusal('invalid_flow');
  // The send must be this session's own, under its workspace. If not, touch nothing.
  const send = await loadSend(user, tenantId, flow.ftrSendId);
  if (!send || send.status !== 'started') throw sendRefusal('invalid_flow');
  if (send.stale) {
    await closeSend(user, tenantId, flow.ftrSendId, { status: 'expired', error: 'send_expired' });
    throw sendRefusal('send_expired');
  }

  try {
    if (!same(input.state, flow.state)) throw sendRefusal('invalid_flow');

    if (input.error !== undefined) {
      // YourTal's own error code at most; free text never reaches the row.
      const cancelled = input.error === 'access_denied';
      const code = /^[a-z_]{1,64}$/.test(input.error) ? input.error : 'yourtal_error';
      await closeSend(user, tenantId, flow.ftrSendId, cancelled
        ? { status: 'cancelled', error: 'access_denied' }
        : { status: 'failed', error: `yourtal_${code}`.slice(0, 100) });
      if (!cancelled) throw sendRefusal('send_refused');
      return { status: 'cancelled', returnTo: flow.returnTo };
    }
    if (!input.code || !input.iss) throw sendRefusal('invalid_flow');

    const claims = await redeemCode(flow.client, { code: input.code, state: input.state, iss: input.iss }, flow);
    const identity = identityFromClaims(claims);
    // Re-checked as docs/30 §6 says: the ID token must say an adult in Australia, and be this session's person.
    if (identity.region !== 'AU' || identity.ageBand !== 'adult') throw sendRefusal('not_allowed');
    const sessionSub = send.subject.startsWith('yourtal|') ? send.subject.slice('yourtal|'.length) : null;
    if (sessionSub === null || !same(identity.sub, sessionSub)) throw sendRefusal('wrong_account');

    if (send.bundle === null || send.yourtal_transfer_id === null) throw sendRefusal('invalid_flow');
    if (createHash('sha256').update(send.bundle, 'utf8').digest('hex') !== send.bundle_sha256) throw sendRefusal('invalid_flow');

    const assertion = await fetchAssertion(send.yourtal_transfer_id, sessionSub);
    const posted = await postBundle(assertion, Buffer.from(send.bundle, 'utf8'));
    if (!posted.ok) {
      throw posted.kind === 'refused' ? sendRefusal('ftr_refused', posted.reason) : sendRefusal('ftr_unavailable');
    }

    if (!(await closeSend(user, tenantId, flow.ftrSendId, { status: 'sent', importId: posted.importId }))) {
      // FTR has it; the row was closed by someone else in the meantime (the sweep). Say so, report what happened.
      logger.warn(`ftr send ${flow.ftrSendId} was sent but already closed`);
    }
    logger.log(`ftr send ok: user=${user.userId} send=${flow.ftrSendId}`);
    return {
      status: 'sent',
      importId: posted.importId,
      financialYear: send.financial_year,
      lineCount: send.line_count,
      returnTo: flow.returnTo,
    };
  } catch (error) {
    // A no-op for a send already closed above (the row count): only an open send is closed here.
    await closeSend(user, tenantId, flow.ftrSendId, { status: 'failed', error: storedCode(error) }).catch(
      () => undefined,
    );
    logger.log(`ftr send refused: ${storedCode(error)} user=${user.userId}`);
    throw error;
  }
}

