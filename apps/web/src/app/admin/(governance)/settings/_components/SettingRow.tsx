'use client';

import { useId, useState, useTransition } from 'react';

import { Button, Field, Input, Td, Textarea, Tr } from '@/design/primitives';
import type { AdminPlatformSetting } from '../../../_data/governance';

import { setPlatformSettingAction } from '../actions';

/**
 * One row of the raw key/value settings table.
 *
 * `value` is `unknown` server-side — there is no dedicated schema per key —
 * so this edits it as JSON text rather than pretending to know its shape.
 * That is the honest reflection of what `AdminPlatformSetting` actually is:
 * `{ key, value: unknown, updatedAt }`, nothing more structured.
 */
export function SettingRow({ setting }: { setting: AdminPlatformSetting }) {
  const textId = useId();
  const reasonId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(setting.value, null, 2));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('Not valid JSON — a plain string still needs quotes, e.g. "on".');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required — this write is audited with it.');
      return;
    }
    startTransition(async () => {
      try {
        await setPlatformSettingAction(setting.key, parsed, reason.trim());
        setEditing(false);
        setReason('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <Tr>
      <Td className="font-mono text-[13px] font-semibold">{setting.key}</Td>
      <Td className="max-w-[380px]">
        {editing ? (
          <Field label="Value (JSON)" htmlFor={textId}>
            <Textarea
              id={textId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="font-mono text-[12px]"
            />
          </Field>
        ) : (
          <pre className="max-w-[380px] overflow-x-auto whitespace-pre-wrap font-mono text-[12px] text-[var(--color-ink-muted)]">
            {JSON.stringify(setting.value)}
          </pre>
        )}
      </Td>
      <Td className="tabular text-[12px] text-[var(--color-ink-faint)]">
        {new Date(setting.updatedAt).toLocaleString('en-AU')}
      </Td>
      <Td align="right">
        {editing ? (
          <div className="flex flex-col items-end gap-2">
            <Field label="Reason" htmlFor={reasonId} hint="Required; audited.">
              <Input
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8 w-56 text-[13px]"
              />
            </Field>
            {error ? <span className="text-[12px] font-semibold text-[var(--color-risk)]">{error}</span> : null}
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </Td>
    </Tr>
  );
}
