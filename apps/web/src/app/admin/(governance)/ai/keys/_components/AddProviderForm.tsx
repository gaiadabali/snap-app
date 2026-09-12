'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Card, Field, Input } from '@/design/primitives';

import { upsertAiProviderAction } from '../actions';

/**
 * Creates a new `ai_provider_configs` row — provider type, a unique label,
 * and an optional default model. Setting its key is a separate step
 * (`KeyForm`, once this row exists and has a `configId`).
 */
export function AddProviderForm() {
  const providerId = useId();
  const labelId = useId();
  const modelId = useId();
  const [provider, setProvider] = useState('');
  const [label, setLabel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!provider.trim() || !label.trim()) {
      setError('Provider and label are both required.');
      return;
    }
    startTransition(async () => {
      try {
        await upsertAiProviderAction({
          provider: provider.trim(),
          label: label.trim(),
          defaultModel: defaultModel.trim() || null,
        });
        setProvider('');
        setLabel('');
        setDefaultModel('');
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add that provider.');
      }
    });
  }

  return (
    <Card tone="ground">
      <h3 className="text-[15px] font-bold">Add a provider configuration</h3>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Creates the row this provider&apos;s key will attach to. Setting the key itself happens below,
        once it appears in the list.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Provider" htmlFor={providerId} hint="e.g. ollama, bedrock, openai">
          <Input id={providerId} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
        <Field label="Label" htmlFor={labelId} hint="Must be unique">
          <Input id={labelId} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Default model (optional)" htmlFor={modelId}>
          <Input id={modelId} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          {error ? <p className="mb-2 text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
          {done ? <p className="mb-2 text-[13px] font-semibold text-[var(--color-good)]">Added.</p> : null}
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? 'Adding…' : 'Add provider'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
