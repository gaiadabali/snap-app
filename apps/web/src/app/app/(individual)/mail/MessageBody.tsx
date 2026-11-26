'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IFRAME_SANDBOX } from '@snap/mail-engine';

import { linkify } from '@/lib/panels/mail-text';

/**
 * Where a message's HTML is shown. `doc` is the engine's `toSandboxDocument()` output of
 * the server's sanitised HTML (a CSP meta first, remote images already stripped).
 *
 * The iframe is the second wall (BUILD.md B6): `sandbox` is exactly the engine's
 * `IFRAME_SANDBOX`, which has no `allow-scripts`, so nothing in a message can run;
 * `allow-same-origin` only lets this page read the frame's height, and without scripts
 * it gives the message no way to use that origin. `referrerPolicy` stops a followed link
 * from telling the next site which page it came from.
 */
export function SandboxFrame({ doc, title }: { doc: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const inner = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(160);

  const measure = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    // The body, not the document element: the latter never reports less than the frame.
    setHeight(Math.max(96, Math.ceil(body.getBoundingClientRect().height) + 4));
  }, []);

  const attach = useCallback(() => {
    measure();
    const d = frame.current?.contentDocument;
    inner.current?.disconnect();
    if (!d?.body || typeof ResizeObserver === 'undefined') return;
    // Inline images and fonts settle after load; a narrower window re-wraps the text.
    inner.current = new ResizeObserver(measure);
    inner.current.observe(d.body);
  }, [measure]);

  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const outer = new ResizeObserver(measure);
    outer.observe(el);
    return () => {
      outer.disconnect();
      inner.current?.disconnect();
    };
  }, [measure]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox={IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={doc}
      onLoad={attach}
      style={{ height }}
      className="block w-full rounded-[var(--radius-sm)] border-0 bg-transparent"
      data-testid="mail-html-frame"
    />
  );
}

/** A plain-text body. React escapes it; only http(s) links become anchors. */
export function PlainBody({ text }: { text: string }) {
  const parts = linkify(text);
  return (
    <div
      data-testid="mail-text-body"
      className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--color-ink)] [overflow-wrap:anywhere]"
    >
      {parts.map((p, i) =>
        p.kind === 'link' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-accent-strong)] underline underline-offset-2"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}
