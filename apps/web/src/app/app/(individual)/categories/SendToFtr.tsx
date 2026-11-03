import { Card, buttonClasses } from '@/design/primitives';

/** The download that hands this year's deductions to Free Tax Returns. A plain anchor: a prefetch would build the file for nothing. */
export function SendToFtr({ href = '/app/deduction-bundle' }: { href?: string }) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose text-[14px]">
          Doing your tax return with Free Tax Returns? Download your deductions for this financial
          year as a file and upload it there. It lists each deduction with its total and a fingerprint
          of each receipt. It has no merchant names, and it does not include the receipt images.
        </p>
        <a href={href} download className={buttonClasses('primary')}>
          Send to Free Tax Returns
        </a>
      </div>
    </Card>
  );
}
