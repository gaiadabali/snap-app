import 'server-only';

import { ApiError, api } from '@/lib/api/server';

/**
 * The one way the admin console reaches the admin plane.
 *
 * Everything under `_data/` goes through here rather than calling `api()`
 * directly, for three reasons that are easy to get wrong once per file:
 *
 *  1. **Admin routes are not workspace-scoped.** `api()` attaches the active
 *     workspace cookie to every request, which for an admin route is at best
 *     noise and at worst a staff member's own workspace leaking into a call
 *     about somebody else's tenant. `adminApi` sends no workspace header
 *     unless a caller explicitly asks for one.
 *
 *  2. **A missing capability is a normal outcome, not a crash.** The admin
 *     plane refuses per capability, from inside Postgres, so a 403 means
 *     "this staff member may not see this panel" — which the UI should render
 *     as a refusal, not an error page. `capabilityGated` turns that into a
 *     typed result.
 *
 *  3. **`reason` is mandatory on a records read** and the server audits it.
 *     Making it a required argument here means no page can forget it and
 *     discover the omission as a 400 at runtime.
 */

export { ApiError };

/** A read that the staff member may simply not be allowed to perform. */
export type Gated<T> =
  | { allowed: true; data: T }
  | { allowed: false; status: 401 | 403; message: string };

type AdminRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Required by the server on every write. One per user intent, not per retry. */
  idempotencyKey?: string;
  /** Only for the routes that genuinely address one tenant by header. */
  workspaceId?: string;
};

export async function adminApi<T>(path: string, options: AdminRequest = {}): Promise<T> {
  return api<T>(path, {
    method: options.method,
    body: options.body,
    idempotencyKey: options.idempotencyKey,
    // Explicitly blank unless asked: see reason 1 above. `api()` would
    // otherwise fall back to the active-workspace cookie.
    workspaceId: options.workspaceId ?? '',
  });
}

/**
 * Runs an admin read and converts an authorisation refusal into data.
 *
 * Only 401 and 403 are absorbed. Everything else still throws — a 500 from
 * the admin plane is a real fault and hiding it behind an empty panel is how
 * an outage looks like a permissions problem for a day.
 */
export async function capabilityGated<T>(read: () => Promise<T>): Promise<Gated<T>> {
  try {
    return { allowed: true, data: await read() };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { allowed: false, status: error.status, message: error.message };
    }
    throw error;
  }
}

/**
 * A staff read of one tenant's actual records.
 *
 * `reason` is required and audited. It is a separate function rather than a
 * flag so that reading a customer's documents can never be an accident of
 * passing the wrong options object.
 */
export async function readTenantRecords<T>(tenantId: string, reason: string): Promise<T> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error('A reason is required to read a tenant’s records, and it is audited.');
  }
  return adminApi<T>(
    `/v1/admin/tenants/${encodeURIComponent(tenantId)}/documents?reason=${encodeURIComponent(trimmed)}`,
  );
}
