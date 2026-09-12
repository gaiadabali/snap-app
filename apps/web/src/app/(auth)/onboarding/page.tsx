import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

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

  return (
    <OnboardingForm
      occupationGroups={occupations}
      initialKind={initialKind}
      error={params.error}
    />
  );
}
