'use client';

import { useState } from 'react';

import { completeOnboardingAction } from '@/lib/auth/actions';

import { AuthField as Field, AuthInput as Input, AuthSelect as Select } from '../_components/ui';

import type { AvailableTaxRules } from '@snap/api-contract';

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
  taxRules,
  initialKind,
  error,
}: {
  occupationGroups: OccupationGroup[];
  taxRules: AvailableTaxRules[];
  initialKind: 'business' | 'personal';
  error?: string;
}) {
  const [kind, setKind] = useState<'business' | 'personal'>(initialKind);
  const [rulesId, setRulesId] = useState('');

  const chosen = taxRules.find((r) => r.rulesId === rulesId) ?? null;

  /**
   * Australia is where the ABN, GST and the D1–D14 deduction worksheet live.
   *
   * Every one of those questions is meaningless — and misleading — under
   * another country's tax law: Indonesia has no ABN, personal taxpayers cannot
   * recover PPN, and there is no itemised deduction worksheet for an individual
   * at all (`docs/INDONESIA.md` §1). Asking anyway would tell a new user this
   * software will do something for them that it cannot.
   *
   * Until a country is chosen this stays true, which keeps the form exactly as
   * it was for every existing Australian signup.
   */
  const isAustralian = chosen === null || chosen.country === 'AU';

  return (
    <div className="auth-panel">
      <div>
        <h1 className="auth-title">Set up your workspace</h1>
        <p className="auth-lede">Three questions, then you are in.</p>
      </div>

      {error ? (
        <div role="alert" className="auth-alert auth-alert-error">
          {error}
        </div>
      ) : null}

      <form action={completeOnboardingAction} className="auth-steps">
        {/* ── Step 1: individual or business ─────────────────────────── */}
        <fieldset className="auth-fieldset">
          <legend className="auth-legend">
            1. What is this workspace for?
          </legend>
          <div className="auth-kinds">
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
        <fieldset className="auth-fieldset">
          <legend className="auth-legend">
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

          {taxRules.length > 0 ? (
            <Field
              label="Where are you taxed?"
              htmlFor="rulesId"
              hint="Sets the tax rules every figure here is worked out under, plus your currency and financial year. Changeable later in settings."
            >
              <Select
                id="rulesId"
                name="rulesId"
                value={rulesId}
                onChange={(e) => setRulesId(e.target.value)}
              >
                <option value="">Australia</option>
                {taxRules.map((r) => (
                  <option key={r.rulesId} value={r.rulesId}>
                    {r.countryName} ({r.consumptionTaxName}, {r.currency})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {kind === 'business' && isAustralian ? (
            <>
              <Field
                label="ABN"
                htmlFor="abn"
                hint="Checked against the ATO checksum before it is saved."
              >
                <Input id="abn" name="abn" inputMode="numeric" placeholder="51 824 753 556" />
              </Field>
              <label className="auth-check">
                <input type="checkbox" name="gstRegistered" />
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
        {isAustralian ? (
          <fieldset className="auth-fieldset">
            <legend className="auth-legend">
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
        ) : (
          /* Not a lesser version of the Australian flow — a different, true
             one. Saying this here is cheaper than letting someone discover it
             after categorising receipts for a month. */
          <fieldset className="auth-fieldset">
            <legend className="auth-legend">
              3. What this will do for you
            </legend>
            <p className="auth-hint">
              {chosen?.countryName} has no itemised deduction worksheet for individuals, so
              there is no occupation to target and no deduction to optimise. What you get is a
              clean record of what you spent, read straight off your receipts, with{' '}
              {chosen?.consumptionTaxName} separated out — and every document kept for as long
              as you are required to keep it.
            </p>
          </fieldset>
        )}

        <button type="submit" className="btn btn-primary btn-lg w-full">
          Finish setup
        </button>
      </form>
    </div>
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
    <label className="auth-kind" data-checked={checked ? "true" : "false"}>
      <input
        type="radio"
        name="kind"
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="auth-kind-label">{label}</span>
      <span className="auth-kind-hint">{hint}</span>
    </label>
  );
}
