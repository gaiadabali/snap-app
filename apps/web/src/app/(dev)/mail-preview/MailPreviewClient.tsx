'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MEMORY_ADDRESS, createMemoryMailClient } from '@snap/mail-engine/testing';

import { MailRoot, useMailRoot } from '../../app/(individual)/mail/MailRoot';
import { SwitchOnView, type SwitchOnPhase } from '../../app/(individual)/mail/SwitchOn';

export const PREVIEW_BASE = '/mail-preview';

/**
 * Answers the browser's `/api/mail/*` calls from memory, so the settings screen (app
 * passwords, switches) and switch-on work in the preview with no server behind them.
 * Installed when this module loads in the browser, before any component effect runs.
 */
function installPreviewApi(): void {
  const original = window.fetch.bind(window);
  const passwords: { id: string; name: string; createdAt: string }[] = [
    { id: 'ap1', name: 'Pixel mail', createdAt: '2026-11-18T01:00:00.000Z' },
  ];
  let settings = { statements: false, workspaceId: null as string | null, alerts: true };
  let next = 2;
  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (!url.startsWith('/api/mail/')) return original(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    await new Promise((r) => setTimeout(r, 250));
    if (url === '/api/mail/enable') return json(200, { state: 'on', address: MEMORY_ADDRESS, created: true });
    if (url === '/api/mail/settings') {
      settings = { ...settings, ...(body as Partial<typeof settings>) };
      return json(200, settings);
    }
    if (url === '/api/mail/app-passwords' && method === 'GET') return json(200, { items: passwords });
    if (url === '/api/mail/app-passwords' && method === 'POST') {
      const made = { id: `ap${next++}`, name: String(body.name ?? ''), createdAt: new Date().toISOString() };
      passwords.push(made);
      return json(201, {
        ...made,
        secret: 'app_preview-only-not-a-real-password',
        username: MEMORY_ADDRESS,
        imap: { host: 'mail.yourtal.gaiada.com', port: 993, security: 'ssl' },
        smtp: { host: 'mail.yourtal.gaiada.com', port: 465, security: 'ssl' },
      });
    }
    if (url.startsWith('/api/mail/app-passwords/') && method === 'DELETE') {
      const at = passwords.findIndex((p) => p.id === url.split('/').pop());
      if (at >= 0) passwords.splice(at, 1);
      return json(204, null);
    }
    return json(404, { code: 'not_found', message: 'Not part of the preview.' });
  };
}

if (typeof window !== 'undefined') installPreviewApi();

/** Lets a browser test (or you, in the console) deliver mail and watch the badge move: `__memoryMail.deliver({ subject: 'Hi', from: { email: 'a@b.co' } })`. */
function ExposeClient() {
  const root = useMailRoot();
  useEffect(() => {
    (window as unknown as { __memoryMail?: unknown }).__memoryMail = root?.client;
  }, [root]);
  return null;
}

/** The mail screens against the engine's in-memory client: ~20 fixture messages, no backend. */
export function MailPreviewRoot({ children }: { children: ReactNode }) {
  return (
    <MailRoot base={PREVIEW_BASE} createClient={() => createMemoryMailClient()}>
      <ExposeClient />
      {children}
    </MailRoot>
  );
}

/** The switch-on screen with a fake delay, so both of its phases can be seen and screenshotted. */
export function PreviewSwitchOn({ start = 'idle' }: { start?: 'idle' | 'done' }) {
  const [phase, setPhase] = useState<SwitchOnPhase>(start === 'done' ? { step: 'done', address: MEMORY_ADDRESS } : { step: 'idle' });
  return (
    <SwitchOnView
      phase={phase}
      onSwitchOn={() => {
        setPhase({ step: 'working' });
        setTimeout(() => setPhase({ step: 'done', address: MEMORY_ADDRESS }), 700);
      }}
      onContinue={() => setPhase({ step: 'idle' })}
    />
  );
}
