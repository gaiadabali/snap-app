import { Text } from '@/theme/text';
import type { Workspace } from '@/api';
import { Notice } from '@/components/ui';

/**
 * The verdict line for a document that passes the tax-invoice checks.
 *
 * Only a business workspace can claim the GST credit (label 1B of the BAS). A
 * personal or household workspace treats GST as a cost (au-2026), so telling it
 * the credit is claimable is wrong. Outside Australia (`taxName` other than
 * GST, e.g. Indonesia's PPN) the ATO and the BAS do not apply at all, so no
 * ATO wording and no claim either way.
 */
export function validInvoiceDetail(opts: {
  workspace: Workspace;
  taxName: string;
  taxAmount: string | null | undefined;
  fmt: (v: string | null | undefined) => string;
}): string {
  if (opts.taxName !== 'GST') return 'Meets the requirements for a tax invoice.';
  if (opts.workspace !== 'business') return 'Meets the ATO requirements for a tax invoice.';
  return `Meets the ATO requirements, so the ${opts.fmt(opts.taxAmount)} GST credit is claimable at label 1B.`;
}

export function ValidInvoiceNotice(props: Parameters<typeof validInvoiceDetail>[0]) {
  return (
    <Notice tone="good" icon="check">
      <Text style={{ fontWeight: '700' }}>Valid tax invoice{'\n'}</Text>
      {validInvoiceDetail(props)}
    </Notice>
  );
}
