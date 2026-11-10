'use client';

import { Button } from '@/design/primitives';

/** The browser's own print dialog; "Save as PDF" is in it. */
export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
