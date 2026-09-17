import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { AvailableTaxRules } from '@snap/api-contract';

import { api } from '@/lib/api/server';
import { hasSessionCookie } from '@/lib/auth/session';

import { OnboardingForm } from './OnboardingForm';

export const metadata: Metadata = { title: 'Set up your workspace' };

type OccupationGroup = { group: string; profiles: Array<{ id: string; label: string }> };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; kind?: string }>;
}) {
  // Onboarding creates the account's first workspace, which only makes sense
  // for someone already identified — a signed-out visitor is sent to sign in
  // first, same as `/app/*` (middleware.ts), rather than this page quietly
  // failing on the API call it would otherwise make.
  if (!(await hasSessionCookie())) {
    redirect('/sign-in?returnTo=/onboarding');
  }

  const params = await searchParams;
  const initialKind = params.kind === 'business' ? 'business' : 'personal';

  // Public endpoint — no session needed — so it is fetched anonymously
  // rather than depending on whatever the session cookie happens to resolve
  // to right now.
  const occupations = await api<OccupationGroup[]>('/v1/settings/occupations', {
    anonymous: true,
  }).catch(() => [] as OccupationGroup[]);

  // The catalogue of installable tax engines. Signed-in but NOT
  // workspace-scoped — there is no workspace yet, which is the whole reason
  // `/v1/tax-rules-catalogue` exists separately from `/v1/tax-rules`.
  //
  // An empty list on failure degrades to the current behaviour: the country
  // step disappears and the workspace is created with no engine, which the
  // settings screen can still fix. A broken catalogue must not block signup.
  const taxRules = await api<AvailableTaxRules[]>('/v1/tax-rules-catalogue').catch(
    () => [] as AvailableTaxRules[],
  );

  return (
    <OnboardingForm
      occupationGroups={occupations}
      taxRules={taxRules}
      initialKind={initialKind}
      error={params.error}
    />
  );
}
