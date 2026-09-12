'use client';

import { Badge } from '@/design/primitives';
import type { ValidatorToggle } from '../../../_data/governance';

import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { ToggleControl } from '../../_components/ToggleControl';
import { setValidatorToggleAction } from '../actions';

/**
 * A `blocking` validator gates whether a document can auto-accept at all —
 * disabling one changes what silently reaches a ledger, so turning one OFF
 * goes through the same blast-radius confirm as a destructive action.
 * Turning one back ON, and anything with `advisory` severity either way, is
 * a plain toggle.
 */
export function ValidatorRow({ validator }: { validator: ValidatorToggle }) {
  const needsConfirmToDisable = validator.severity === 'blocking';

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-rule)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{validator.label}</span>
          <Badge tone={validator.severity === 'blocking' ? 'risk' : 'neutral'}>{validator.severity}</Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{validator.description}</p>
      </div>

      {needsConfirmToDisable && validator.enabled ? (
        <ConfirmDialog
          triggerLabel="Disable"
          triggerVariant="danger"
          title={`Disable "${validator.label}"`}
          confirmPhrase="DISABLE"
          blastRadius={
            <>
              This is a <strong>blocking</strong> validator — it gates whether a document can
              auto-accept. Disabling it means documents that would have failed this check can now
              reach <code>auto_accepted</code> without a human reviewing them. This applies to every
              extraction from the moment it is disabled.
            </>
          }
          onConfirm={async (typed) => {
            if (typed !== 'DISABLE') throw new Error('Type DISABLE to confirm.');
            await setValidatorToggleAction(validator.key, false);
          }}
        />
      ) : (
        <ToggleControl
          key={`${validator.key}-${validator.enabled}`}
          checked={validator.enabled}
          label={validator.label}
          onToggle={(next) => setValidatorToggleAction(validator.key, next)}
        />
      )}
    </div>
  );
}
