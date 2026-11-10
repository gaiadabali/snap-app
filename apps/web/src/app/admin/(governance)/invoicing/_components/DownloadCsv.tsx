'use client';

import { Button } from '@/design/primitives';

/** Saves the report's CSV, which the server already wrote, as a file. */
export function DownloadCsv({ filename, csv }: { filename: string; csv: string }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Download CSV
    </Button>
  );
}
