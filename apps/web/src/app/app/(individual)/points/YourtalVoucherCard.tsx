import type { YourtalLinkStatus } from '@snap/api-contract';

import { Button, Card, Field, Input } from '@/design/primitives';
import {
  VOUCHER_COPY,
  grantedMessage,
  redemptionLabel,
  voucherErrorMessage,
  voucherUnavailableNote,
  type VoucherOutcome,
} from '@/lib/yourtal-voucher';

export interface YourtalVoucherCardProps {
  vouchers: NonNullable<YourtalLinkStatus['vouchers']>;
  /** The workspace the scans go to, for "50 scans added to {workspace}". */
  workspaceName: string;
  code: string;
  onCodeChange: (code: string) => void;
  onSubmit: (code: string) => void;
  busy: boolean;
  outcome: VoucherOutcome | null;
}

/**
 * "Use a YourTal voucher" (group plan 2.8, docs/28 §5): controlled, so every
 * state renders from props (`YourtalVoucherCard.test.tsx`). Shows the form only
 * when the server says `available`; for a region or role refusal it explains,
 * and otherwise it renders nothing. A voucher adds scans, never money.
 */
export function YourtalVoucherCard({ vouchers, workspaceName, code, onCodeChange, onSubmit, busy, outcome }: YourtalVoucherCardProps) {
  const note = voucherUnavailableNote(vouchers);
  if (!vouchers.available && !note) return null;

  const history = vouchers.redemptions.length > 0 && (
    <section className="flex flex-col gap-2">
      <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{VOUCHER_COPY.historyTitle}</h3>
      <ul className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] px-4">
        {vouchers.redemptions.map((r) => (
          <li key={r.id} className="py-2 text-[14px] text-[var(--color-ink)]">
            {redemptionLabel(r)}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <Card className="flex max-w-[480px] flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">{VOUCHER_COPY.title}</h2>
      {note ? (
        <p className="text-[14px] text-[var(--color-ink-muted)]">{note}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() !== '' && !busy) onSubmit(code);
          }}
        >
          <p className="text-[14px] text-[var(--color-ink-muted)]">{VOUCHER_COPY.intro}</p>
          <Field label={VOUCHER_COPY.codeLabel} htmlFor="yourtal-voucher-code">
            <Input
              id="yourtal-voucher-code"
              name="voucher"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder={VOUCHER_COPY.codePlaceholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>
          <p className="text-[13px] text-[var(--color-ink-muted)]">{VOUCHER_COPY.hint}</p>
          {outcome?.kind === 'granted' ? (
            <p role="status" className="text-[14px] text-[var(--color-good)]">
              {grantedMessage(outcome.credits, workspaceName)}
            </p>
          ) : null}
          {outcome?.kind === 'pending' ? (
            <p role="status" className="text-[14px] text-[var(--color-ink)]">
              {VOUCHER_COPY.pending}
            </p>
          ) : null}
          {outcome?.kind === 'error' ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-[var(--color-risk)] p-3 text-[14px] text-[var(--color-risk)]"
            >
              {voucherErrorMessage(outcome.code, outcome.redeemedAt)}
            </p>
          ) : null}
          <Button type="submit" disabled={code.trim() === '' || busy} className="w-fit">
            {busy ? VOUCHER_COPY.busy : VOUCHER_COPY.button}
          </Button>
        </form>
      )}
      {history}
    </Card>
  );
}
