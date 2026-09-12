'use client';

import { useState } from 'react';

import { Button, Card, Field, Input, Select } from '@/design/primitives';
import { completeOnboardingAction } from '@/lib/auth/actions';

type OccupationGroup = { group: string; profiles: Array<{ id: string; label: string }> };

/**
 * The three questions from `docs/PLAN.md`'s onboarding: individual or
 * business, the workspace's own details, then whatever that kind still needs
 * — presented as three visual steps over ONE form, which submits once to
 * `completeOnboardingAction` (and from there, `POST /v1/workspaces/onboarding`
 * in exactly the shape its `OnboardingDto` expects). Only the kind toggle
 * needs client-side state — everything else is a plain server-actioned form.
 */
export function OnboardingForm({
  occupationGroups,
  initialKind,
  error,
}: {
  occupationGroups: OccupationGroup[];
  initialKind: 'business' | 'personal';
  error?: string;
}) {
  const [kind, setKind] = useState<'business' | 'personal'>(initialKind);

  return (
    <Card className="flex w-full max-w-[520px] flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">
          Set up your workspace
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--color-ink-muted)]">
          Three questions, then you are in.
        </p>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] px-3 py-2 text-[13px] text-[var(--color-risk)]">
          {error}
        </div>
      ) : null}

      <form action={completeOnboardingAction} className="flex flex-col gap-8">
        {/* ── Step 1: individual or business ─────────────────────────── */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[13px] font-semibold text-[var(--color-ink)]">
            1. What is this workspace for?
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <KindOption
              value="personal"
              label="Just me / my household"
              hint="No GST, no ABN — a personal spending and deduction tracker."
              checked={kind === 'personal'}
              onSelect={() => setKind('personal')}
            />
            <KindOption
              value="business"
              label="A business"
              hint="BAS, GST, and an ABN."
              checked={kind === 'business'}
              onSelect={() => setKind('business')}
            />
          </div>
        </fieldset>

        {/* ── Step 2: workspace details ───────────────────────────────── */}
        <fieldset className="flex flex-col gap-4">
          <legend className="text-[13px] font-semibold text-[var(--color-ink)]">
            2. Name it
          </legend>
          <Field label="Workspace name" htmlFor="workspaceName">
            <Input
              id="workspaceName"
              name="workspaceName"
              placeholder={kind === 'business' ? 'Acme Trades Pty Ltd' : 'Our household'}
              required
            />
          </Field>

          {kind === 'business' ? (
            <>
              <Field
                label="ABN"
                htmlFor="abn"
                hint="Checked against the ATO checksum before it is saved."
              >
                <Input id="abn" name="abn" inputMode="numeric" placeholder="51 824 753 556" />
              </Field>
              <label className="flex items-center gap-2 text-[14px] text-[var(--color-ink)]">
                <input type="checkbox" name="gstRegistered" className="h-4 w-4" />
                Registered for GST
              </label>
              <Field label="GST basis" htmlFor="gstBasis">
                <Select id="gstBasis" name="gstBasis" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="accrual">Accrual</option>
                </Select>
              </Field>
            </>
          ) : (
            <Field
              label="Monthly budget (optional)"
              htmlFor="monthlyBudget"
              hint="What you intend to spend each month — a starting point, not a limit."
            >
              <Input id="monthlyBudget" name="monthlyBudget" inputMode="decimal" placeholder="2500" />
            </Field>
          )}
        </fieldset>

        {/* ── Step 3: occupation, for deduction targeting ─────────────── */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[13px] font-semibold text-[var(--color-ink)]">
            3. Occupation (optional)
          </legend>
          <Field
            label="What best describes this work?"
            htmlFor="occupationProfileId"
            hint="Targets the right deduction rows on your tax worksheet. Change it later in settings."
          >
            <Select id="occupationProfileId" name="occupationProfileId" defaultValue="">
              <option value="">Not sure yet</option>
              {occupationGroups.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        </fieldset>

        <Button type="submit" size="lg">
          Finish setup
        </Button>
      </form>
    </Card>
  );
}

function KindOption({
  value,
  label,
  hint,
  checked,
  onSelect,
}: {
  value: 'business' | 'personal';
  label: string;
  hint: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-rule-strong)] hover:bg-[var(--color-surface-alt)]'
      }`}
    >
      <input
        type="radio"
        name="kind"
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="text-[14px] font-semibold text-[var(--color-ink)]">{label}</span>
      <span className="text-[12px] text-[var(--color-ink-muted)]">{hint}</span>
    </label>
  );
}
