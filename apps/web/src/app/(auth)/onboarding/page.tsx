import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { AvailableTaxRules } from '@snap/api-contract';

import { api } from '@/lib/api/server';
import { authNotice } from '@/lib/auth/auth-errors';
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

  // Reference data, not workspace data: there is no workspace yet, so the
  // workspace-scoped `/v1/settings/occupations` would 401 here (that left the
  // picker at "Not sure yet"). `/v1/occupations` is unguarded, so it is
  // fetched anonymously. Both kinds are loaded because the form can switch
  // between them client-side and a personal workspace is not offered `sole`.
  const [personalOccupations, businessOccupations] = await Promise.all(
    (['personal', 'business'] as const).map((kind) =>
      api<OccupationGroup[]>(`/v1/occupations?kind=${kind}`, { anonymous: true }).catch(
        () => [] as OccupationGroup[],
      ),
    ),
  );

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
      occupationGroups={{ personal: personalOccupations!, business: businessOccupations! }}
      taxRules={taxRules}
      initialKind={initialKind}
      error={authNotice(params.error)?.message}
    />
  );
}
