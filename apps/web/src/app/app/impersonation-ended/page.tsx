import { Badge, Container } from '@/design/primitives';
import { getPanelImpersonation } from '@/lib/panels/impersonation';
import { exitImpersonation } from '@/lib/panels/actions';

export const metadata = { title: 'Impersonation session ended' };

/**
 * Where a dead impersonation session lands — docs/WEB.md §6 point 3 says
 * verification happens per request, so this is reached the moment a stop,
 * an expiry, or a revoked capability makes the very next call 401.
 *
 * Deliberately outside `(individual)/` and `business/`, so it does NOT go
 * through their layouts: those call `requireSession()`, which is exactly
 * what sent the browser here after catching `ImpersonationEndedError` — a
 * layout that repeated that call would just redirect back to itself.
 * This page makes no `api()` call at all; it only reads the (still-present,
 * not yet cleared) impersonation cookie to say whose session this was.
 */
export default async function ImpersonationEndedPage() {
  const impersonation = await getPanelImpersonation();

  return (
    <main className="flex min-h-screen items-center justify-center py-20">
      <Container width="prose">
        <Badge tone="risk">Impersonation</Badge>
        <h1 className="mt-3 text-[22px] font-bold text-[var(--color-ink)]">This impersonation session has ended</h1>

        <div className="mt-5 rounded-[var(--radius-lg)] border-2 border-[var(--color-risk)] bg-[var(--color-risk-soft)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
            {impersonation ? (
              <>
                The session viewing <strong>{impersonation.subjectName}</strong>&rsquo;s records in{' '}
                <strong>{impersonation.tenantName}</strong> is no longer valid — it expired, was stopped, or the
                capability behind it was revoked. Every request under it is checked again on its own, so this is
                expected the moment any of those happen, not a bug.
              </>
            ) : (
              <>That impersonation session is no longer valid.</>
            )}
          </p>
          <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
            Nothing further can be done here as that account. Return to the admin console to start a new session if
            one is still needed.
          </p>
          <form action={exitImpersonation} className="mt-5">
            <button
              type="submit"
              className="w-full rounded-[var(--radius-md)] bg-[var(--color-ink)] px-4 py-2.5 text-[14px] font-bold text-[var(--color-ground)] transition-opacity hover:opacity-85 sm:w-auto"
            >
              Return to admin
            </button>
          </form>
        </div>
      </Container>
    </main>
  );
}
