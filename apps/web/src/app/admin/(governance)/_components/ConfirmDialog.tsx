'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';

import { Button, Field, Input } from '@/design/primitives';

/**
 * The gate every destructive or expensive governance action goes through.
 *
 * Per the brief: "Any destructive or expensive operation ... must require
 * explicit confirmation that names the blast radius." So this never opens on
 * a generic "are you sure?" — `blastRadius` is required, and the confirm
 * button stays disabled until the operator types the exact phrase, which
 * means reading it is unavoidable rather than a reflexive click-through.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = 'danger',
  title,
  blastRadius,
  confirmPhrase,
  onConfirm,
  disabled = false,
}: {
  triggerLabel: string;
  triggerVariant?: 'danger' | 'secondary' | 'primary';
  title: string;
  /** Must name what this touches — document counts, tenants, estimated cost. */
  blastRadius: ReactNode;
  confirmPhrase: string;
  onConfirm: (typedPhrase: string) => Promise<void>;
  disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setTyped('');
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }
  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm(typed);
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That failed.');
      }
    });
  }

  return (
    <>
      <Button variant={triggerVariant} size="sm" onClick={open} disabled={disabled}>
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        onCancel={close}
        className={
          'w-full max-w-[520px] rounded-[var(--radius-lg)] border border-[var(--color-rule-strong)] ' +
          'bg-[var(--color-surface)] p-0 text-[var(--color-ink)] shadow-[var(--shadow-lift)] ' +
          'backdrop:bg-[#04101E]/60'
        }
      >
        <div className="p-6">
          <h3 className="text-[18px] font-bold">{title}</h3>

          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] p-4 text-[14px] leading-relaxed text-[var(--color-ink)]">
            {blastRadius}
          </div>

          <div className="mt-5">
            <Field label={`Type ${confirmPhrase} to confirm`} htmlFor="confirm-phrase">
              <Input
                id="confirm-phrase"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
                autoComplete="off"
                className="font-mono tracking-wide"
              />
            </Field>
          </div>

          {error ? <p className="mt-3 text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={confirm}
              disabled={typed !== confirmPhrase || pending}
            >
              {pending ? 'Working…' : title}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
