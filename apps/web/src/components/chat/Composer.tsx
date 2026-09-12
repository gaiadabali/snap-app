'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/design/primitives';

export function Composer({
  onSend,
  onCancel,
  sending,
}: {
  onSend: (text: string) => void;
  onCancel: () => void;
  sending: boolean;
}) {
  const [value, setValue] = useState('');

  const submit = () => {
    if (!value.trim() || sending) return;
    onSend(value);
    setValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-[var(--color-rule)] p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a receipt, GST, or your BAS…"
          rows={1}
          aria-label="Message"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-3 py-2 text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
        />
        {sending ? (
          <Button type="button" variant="secondary" size="md" onClick={onCancel}>
            Stop
          </Button>
        ) : (
          <Button type="button" size="md" onClick={submit} disabled={!value.trim()}>
            Send
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
        Not yet connected to a model — see the note in this panel's header.
      </p>
    </div>
  );
}
