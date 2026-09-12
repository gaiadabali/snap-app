'use client';

import { useActionState } from 'react';
import type { BusinessSettings } from '@snap/api-contract';

import { Badge, Button, Card, Field, Input, SectionTitle, Select } from '@/design/primitives';
import type { ActionResult } from '@/lib/panels/actions';

export function SettingsForm({
  settings,
  occupations,
  canEdit,
  isBusiness,
  onSave,
}: {
  settings: BusinessSettings;
  occupations: Array<{ group: string; profiles: Array<{ id: string; label: string }> }>;
  canEdit: boolean;
  isBusiness: boolean;
  onSave: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(onSave, null);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Settings"
        lede={
          isBusiness
            ? 'ABN, GST registration and the occupation profile that decides which deduction rows your scans can land in.'
            : 'A household is never asked about GST, an ABN or a tax invoice — that language belongs to the business side only.'
        }
      />
      <Card className="max-w-[560px]">
        <form action={formAction} className="flex flex-col gap-4">
          <Field label={isBusiness ? 'Business name' : 'Household name'}>
            <Input name="name" defaultValue={settings.name} disabled={!canEdit} required />
          </Field>

          {isBusiness ? (
            <>
              <Field label="ABN" hint={settings.abn ? (settings.abnValid ? 'Valid' : 'Fails the ATO checksum') : 'Not set'}>
                <Input name="abn" defaultValue={settings.abn ?? ''} disabled={!canEdit} placeholder="11 digits" />
              </Field>
              <label className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]">
                <input type="checkbox" name="gstRegistered" defaultChecked={settings.gstRegistered} disabled={!canEdit} className="h-4 w-4" />
                Registered for GST
              </label>
              <Field label="GST basis">
                <Select name="gstBasis" defaultValue={settings.gstBasis} disabled={!canEdit}>
                  <option value="cash">Cash</option>
                  <option value="accrual">Accrual</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]">
                <input type="checkbox" name="simplerBas" defaultChecked={settings.simplerBas} disabled={!canEdit} className="h-4 w-4" />
                Report Simpler BAS (G1, 1A, 1B only)
              </label>
            </>
          ) : null}

          <Field label="Occupation profile" hint="Decides which deduction rows your scans can be matched against.">
            <Select name="occupationProfileId" defaultValue={settings.occupationProfileId ?? ''} disabled={!canEdit}>
              <option value="">Not set</option>
              {occupations.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {settings.occupationLabel ? <Badge tone="accent">{settings.occupationLabel}</Badge> : null}

          {!canEdit ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">Only an owner or manager can change these.</p>
          ) : state && !state.ok ? (
            <p className="text-[13px] text-[var(--color-risk)]">{state.message}</p>
          ) : state?.ok ? (
            <p className="text-[13px] text-[var(--color-good)]">Saved.</p>
          ) : null}

          <div>
            <Button type="submit" disabled={!canEdit || pending}>
              {pending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
