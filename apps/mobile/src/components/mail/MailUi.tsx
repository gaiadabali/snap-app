import { useEffect, useState } from 'react';

import { Body, Button, Card } from '@/components/ui';
import { space } from '@/theme';

/** A message for the NEXT screen: "Moved to Spam." belongs on the list the person lands on. */
let flash: string | null = null;

export function flashNotice(text: string): void {
  flash = text;
}

/** The pending message, once. The list calls this when it is shown again (it stays mounted under the reader). */
export function consumeFlash(): string | null {
  const text = flash;
  flash = null;
  return text;
}

function takeFlash(): { tone: 'good'; text: string } | null {
  const text = flash;
  flash = null;
  return text === null ? null : { tone: 'good', text };
}

export type NoticeState = { tone: 'good' | 'risk'; text: string } | null;

/** Notice state: what just happened or what went wrong. A success clears itself; an error stays until dismissed. */
export function useNotice(): {
  notice: NoticeState;
  say: (text: string) => void;
  fail: (text: string) => void;
  clear: () => void;
} {
  const [notice, setNotice] = useState<NoticeState>(takeFlash);
  useEffect(() => {
    if (!notice || notice.tone === 'risk') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return {
    notice,
    say: (text) => setNotice({ tone: 'good', text }),
    fail: (text) => setNotice({ tone: 'risk', text }),
    clear: () => setNotice(null),
  };
}

/** A failed read with a way out, never a blank screen. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ gap: space.md, alignItems: 'center' }}>
      <Body style={{ textAlign: 'center' }}>{message}</Body>
      {onRetry ? <Button label="Try again" tone="outline" onPress={onRetry} /> : null}
    </Card>
  );
}
