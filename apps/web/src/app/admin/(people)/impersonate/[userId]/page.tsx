import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, Empty, Field, Input } from '@/design/primitives';

import { CapabilityRefusal } from '../../../_components/CapabilityRefusal';
import { ImpersonateForm } from '../../../_components/ImpersonateForm';
import { getUser } from '../../../_data/people';
import { getTenant, listTenants } from '../../../_data/tenants';

export const metadata = { title: 'Confirm impersonation' };

/**
 * The impersonation confirmation step — docs/WEB.md §6 point 3.
 *
 * Starting a session needs BOTH a user and a tenant
 * (`AdminImpersonationStartRequest.subjectTenantId` is required, and the
 * database refuses the pair if the user is not actually a member of that
 * tenant). There is no endpoint that maps a user to their tenants — see
 * `_data/people.ts` — so this is a two-step page: search and pick the real
 * tenant first (via the real `GET /v1/admin/tenants`), then confirm. Neither
 * step invents anything; it just asks the staff member for what the backend
 * cannot look up on their behalf.
 */
export default async function ImpersonateConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tenantId?: string; tenantQuery?: string }>;
}) {
  const { userId } = await params;
  const { tenantId, tenantQuery } = await searchParams;

  const userResult = await getUser(userId);
  if (!userResult.allowed) {
    return (
      <CapabilityRefusal
        status={userResult.status}
        message={`${userResult.message} This staff account is missing the "view_tenant_metadata" capability.`}
      />
    );
  }
  const user = userResult.data;
  if (!user) notFound();

  const subjectLabel = user.displayName ?? user.email ?? user.userId;

  if (tenantId) {
    const detail = await getTenant(tenantId);
    if (!detail.allowed) {
      return (
        <CapabilityRefusal
          status={detail.status}
          message={`${detail.message} This staff account is missing the "view_tenant_metadata" capability.`}
        />
      );
    }
    if (!detail.data) {
      return (
        <div className="mx-auto max-w-[640px] space-y-4">
          <Empty title="That tenant could not be found" body="Pick a different tenant below." />
          <Link
            href={`/admin/impersonate/${userId}`}
            className="inline-block text-[13px] text-[var(--color-ink-muted)] hover:underline"
          >
            ← Choose a tenant
          </Link>
        </div>
      );
    }
    const tenant = detail.data;

    return (
      <div className="mx-auto max-w-[640px] space-y-6">
        <div>
          <Badge tone="risk">Impersonation</Badge>
          <h1 className="mt-2 text-[22px] font-bold text-[var(--color-ink)]">Start an impersonation session</h1>
        </div>

        <div className="rounded-[var(--radius-lg)] border-2 border-[var(--color-risk)] bg-[var(--color-risk-soft)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-[14px] text-[var(--color-ink)]">
            You are about to open <strong>{subjectLabel}</strong>
            {user.email ? (
              <>
                {' '}
                (<span className="font-mono">{user.email}</span>)
              </>
            ) : null}
            &rsquo;s financial records in <strong>{tenant.name}</strong>. This includes every receipt, invoice, and BAS
            figure they can see there.
          </p>
          <ul className="mt-3 space-y-1 text-[13px] text-[var(--color-ink-muted)]">
            <li>The session is short-lived and ends itself (up to 30 minutes).</li>
            <li>
              A banner naming <strong>{subjectLabel}</strong> and <strong>{tenant.name}</strong> will follow every page
              until you exit.
            </li>
            <li>This event and your reason are written to the audit trail, and re-checked on every read.</li>
          </ul>
        </div>

        <Card>
          <ImpersonateForm
            subjectUserId={user.userId}
            subjectTenantId={tenant.tenantId}
            subjectLabel={subjectLabel}
            subjectEmail={user.email}
            tenantName={tenant.name}
          />
        </Card>

        <Link
          href={`/admin/impersonate/${userId}`}
          className="inline-block text-[13px] text-[var(--color-ink-muted)] hover:underline"
        >
          ← Choose a different tenant
        </Link>
      </div>
    );
  }

  // Step 1: pick the tenant. `subjectTenantId` cannot be inferred, so the
  // staff member searches the real tenant list and picks the one the user
  // actually belongs to (the database refuses the pair otherwise).
  const searchResult = tenantQuery ? await listTenants({ query: tenantQuery, pageSize: 20 }) : null;

  return (
    <div className="mx-auto max-w-[640px] space-y-6">
      <div>
        <Badge tone="risk">Impersonation</Badge>
        <h1 className="mt-2 text-[22px] font-bold text-[var(--color-ink)]">
          Which tenant is <span className="whitespace-nowrap">{subjectLabel}</span> in?
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          There is no lookup from a user to their tenants yet — search for the tenant this support ticket names, and
          confirm it belongs to this user on the next step.
        </p>
      </div>

      <Card>
        <form method="GET" className="flex items-end gap-3">
          <Field label="Tenant name or ABN" htmlFor="tenantQuery">
            <Input id="tenantQuery" name="tenantQuery" defaultValue={tenantQuery ?? ''} placeholder="e.g. Coastal Electrical" className="w-72" />
          </Field>
          <button
            type="submit"
            className="h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[14px] font-semibold text-[var(--color-accent-ink)]"
          >
            Search
          </button>
        </form>

        {searchResult ? (
          !searchResult.allowed ? (
            <div className="mt-4">
              <CapabilityRefusal
                status={searchResult.status}
                message={`${searchResult.message} This staff account is missing the "view_tenant_metadata" capability.`}
              />
            </div>
          ) : searchResult.data.items.length === 0 ? (
            <div className="mt-4">
              <Empty title="No tenants match that search" />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--color-rule)]">
              {searchResult.data.items.map((t) => (
                <li key={t.tenantId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--color-ink)]">{t.name}</div>
                    <div className="text-[12px] text-[var(--color-ink-faint)]">{t.planCode ?? 'No active plan'}</div>
                  </div>
                  <Link
                    href={`/admin/impersonate/${userId}?tenantId=${encodeURIComponent(t.tenantId)}`}
                    className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-accent-ink)]"
                  >
                    Use this tenant
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>

      <Link href={`/admin/people/${userId}`} className="inline-block text-[13px] text-[var(--color-ink-muted)] hover:underline">
        ← Cancel and go back
      </Link>
    </div>
  );
}
