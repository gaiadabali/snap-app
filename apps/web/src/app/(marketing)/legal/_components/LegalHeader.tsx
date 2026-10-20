import type { ReactNode } from 'react';

/** A calm page header: label, title, and the draft/last-updated line. */
export function LegalHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <header className="legal-header">
      <div className="kicker">Legal</div>
      <h1 className="legal-title">{title}</h1>
      {meta ? <p className="legal-meta">{meta}</p> : null}
    </header>
  );
}
