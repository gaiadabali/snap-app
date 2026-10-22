import type { YourtalLinkStatus } from '@snap/api-contract';

import { Button, ButtonLink, Card, Field, Input } from '@/design/primitives';
import {
  LINK_COPY,
  cleanLinkCode,
  linkErrorMessage,
  linkedOn,
  identityNotice,
  otherRefused,
  type LinkContext,
} from '@/lib/yourtal-link';

/** What the page knows. `ready` carries the server's answer untouched. */
export type LinkLoad = { kind: 'error' } | { kind: 'ready'; status: YourtalLinkStatus };

export interface YourtalLinkViewProps {
  load: LinkLoad;
  /** Absolute YourTal URLs, built from `YOURTAL_WEB_URL`. */
  links: { getCode: string; wallet: string };
  /** Where "Try again" goes: this page, so the server reads the status again. */
  retryHref: string;
  /** Where "Confirm your email" goes: the existing email-confirmation page. */
  verifyEmailHref: string;
  code: string;
  onCodeChange: (code: string) => void;
  onLink: (code: string) => void;
  /** Which request is in flight, if any. */
  busy: LinkContext | null;
  /** The last failed link or unlink, as the server's `error` code (or none for a network failure). */
  error: { context: LinkContext; code: string | null } | null;
  /** The unlink confirm step is showing. */
  confirming: boolean;
  onAskUnlink: () => void;
  onCancelUnlink: () => void;
  onConfirmUnlink: () => void;
}

/** A link that leaves for YourTal. */
function External({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="w-fit text-[14px] font-medium text-[var(--color-accent)] underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-[14px] text-[var(--color-ink)]">{label}</dt>
        <dd className="font-mono text-[15px] tabular text-[var(--color-ink)]">{value}</dd>
      </div>
      {hint ? <p className="text-[13px] text-[var(--color-ink-muted)]">{hint}</p> : null}
    </div>
  );
}

/** Receipts scanned now will not earn: Snap Apps' receipt package at YourTal is used up. */
function PausedNotice() {
  return (
    <div
      role="status"
      className="max-w-[480px] rounded-[var(--radius-md)] border border-[var(--color-warn)] p-4 text-[14px] text-[var(--color-ink)]"
    >
      <p className="font-semibold">{LINK_COPY.pausedTitle}</p>
      <p className="mt-1 text-[var(--color-ink-muted)]">{LINK_COPY.pausedBody}</p>
    </div>
  );
}

/** The person has not passed YourTal's identity check: receipts scanned now won't earn. */
function IdentityNotice({ check, meHref }: { check: YourtalLinkStatus['identityCheck']; meHref: string }) {
  const { lines, showLink } = identityNotice(check);
  if (lines.length === 0) return null;
  return (
    <div
      role="status"
      className="flex max-w-[480px] flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-warn)] p-4 text-[14px] text-[var(--color-ink)]"
    >
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {showLink ? <External href={meHref}>{LINK_COPY.identityVerifyEmailLink}</External> : null}
    </div>
  );
}

function ErrorNotice({
  error,
  verifyEmailHref,
}: {
  error: NonNullable<YourtalLinkViewProps['error']>;
  verifyEmailHref: string;
}) {
  const message = linkErrorMessage(error.code, error.context);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--color-risk)] p-3 text-[14px] text-[var(--color-risk)]"
    >
      <p>{message.text}</p>
      {message.action === 'verify-email' ? (
        <a href={verifyEmailHref} className="w-fit font-medium underline underline-offset-2">
          {LINK_COPY.confirmEmail}
        </a>
      ) : null}
    </div>
  );
}

/** Shown by the route's `loading.tsx` while the status is read. */
export function YourtalLinkLoading() {
  return (
    <p role="status" aria-label="Loading your YourTal link" className="text-[14px] text-[var(--color-ink-muted)]">
      Loading your YourTal link…
    </p>
  );
}

/**
 * The YourTal points link: one view for every state (group plan 2.6).
 *
 * Controlled and free of data fetching, so each state renders from props
 * alone (`YourtalLinkView.test.tsx` renders them all). `YourtalLinkClient`
 * owns the state and the calls; `page.tsx` owns the read.
 *
 * Renders NOTHING when the server says `available: false`: that is a server
 * without YourTal credentials, and a page offering a link that cannot work is
 * worse than none. (The page itself also answers 404 then.)
 */
export function YourtalLinkView(props: YourtalLinkViewProps) {
  const { load, links, code, busy, error } = props;

  if (load.kind === 'error') {
    return (
      <div className="flex max-w-[480px] flex-col gap-3">
        <div role="alert" className="text-[14px] text-[var(--color-risk)]">
          {LINK_COPY.loadError}
        </div>
        <ButtonLink href={props.retryHref} variant="secondary" size="sm" className="w-fit">
          {LINK_COPY.retry}
        </ButtonLink>
      </div>
    );
  }

  const { status } = load;
  if (!status.available) return null;

  const codeForm = (buttonLabel: string) => (
    <form
      className="flex max-w-[480px] flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (cleanLinkCode(code) !== '' && busy === null) props.onLink(cleanLinkCode(code));
      }}
    >
      <Field label={LINK_COPY.codeLabel} htmlFor="yourtal-link-code">
        <Input
          id="yourtal-link-code"
          name="code"
          value={code}
          onChange={(e) => props.onCodeChange(e.target.value)}
          placeholder={LINK_COPY.codePlaceholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      {error && error.context === 'link' ? (
        <ErrorNotice error={error} verifyEmailHref={props.verifyEmailHref} />
      ) : null}
      <Button type="submit" disabled={cleanLinkCode(code) === '' || busy !== null} className="w-fit">
        {busy === 'link' ? 'Linking…' : buttonLabel}
      </Button>
    </form>
  );

  if (status.state === 'linked') {
    const since = linkedOn(status.linkedAt);
    return (
      <div className="flex flex-col gap-6">
        <IdentityNotice check={status.identityCheck} meHref={links.getCode} />
        {status.receiptPoints?.state === 'paused' ? <PausedNotice /> : null}
        <Card tone="accent" className="max-w-[480px]">
          <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">{LINK_COPY.linkedTitle}</h2>
          {since ? <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{`Since ${since}`}</p> : null}
        </Card>

        <section className="flex max-w-[480px] flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Your receipts</h2>
          <dl className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] px-4">
            <StatRow label={LINK_COPY.rowRewarded} value={status.receipts.rewarded.toLocaleString('en-AU')} />
            <StatRow label={LINK_COPY.rowPending} value={status.receipts.pending.toLocaleString('en-AU')} />
            <StatRow
              label={LINK_COPY.rowDuplicate}
              value={status.receipts.skippedDuplicate.toLocaleString('en-AU')}
              hint={LINK_COPY.duplicateHint}
            />
            <StatRow
              label={LINK_COPY.rowFree}
              value={status.receipts.skippedFree.toLocaleString('en-AU')}
              hint={LINK_COPY.freeHint}
            />
            {status.receipts.pausedRefused > 0 ? (
              <StatRow
                label={LINK_COPY.rowPaused}
                value={status.receipts.pausedRefused.toLocaleString('en-AU')}
                hint={LINK_COPY.pausedHint}
              />
            ) : null}
            {status.receipts.identityRefused > 0 ? (
              <StatRow
                label={LINK_COPY.rowIdentity}
                value={status.receipts.identityRefused.toLocaleString('en-AU')}
                hint={LINK_COPY.identityHint}
              />
            ) : null}
            {otherRefused(status.receipts) > 0 ? (
              <StatRow
                label={LINK_COPY.rowRefused}
                value={otherRefused(status.receipts).toLocaleString('en-AU')}
                hint={LINK_COPY.refusedHint}
              />
            ) : null}
            <StatRow label={LINK_COPY.rowPoints} value={status.pointsReported.toLocaleString('en-AU')} />
          </dl>
          <p className="text-[13px] text-[var(--color-ink-muted)]">{LINK_COPY.linkedHint}</p>
          <External href={links.wallet}>{LINK_COPY.openWallet}</External>
        </section>

        {error && error.context === 'unlink' ? (
          <div className="max-w-[480px]">
            <ErrorNotice error={error} verifyEmailHref={props.verifyEmailHref} />
          </div>
        ) : null}

        {props.confirming ? (
          <div
            role="alertdialog"
            aria-label={LINK_COPY.unlinkConfirmTitle}
            className="flex max-w-[480px] flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)] p-4"
          >
            <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">{LINK_COPY.unlinkConfirmTitle}</h2>
            <p className="text-[14px] text-[var(--color-ink-muted)]">{LINK_COPY.unlinkConfirmBody}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" size="sm" disabled={busy === 'unlink'} onClick={props.onConfirmUnlink}>
                {busy === 'unlink' ? 'Unlinking…' : LINK_COPY.unlinkConfirmButton}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === 'unlink'}
                onClick={props.onCancelUnlink}
              >
                {LINK_COPY.unlinkCancelButton}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" className="w-fit" onClick={props.onAskUnlink}>
            {LINK_COPY.unlinkButton}
          </Button>
        )}
      </div>
    );
  }

  if (status.state === 'broken') {
    return (
      <div className="flex flex-col gap-6">
        <div
          role="status"
          className="max-w-[480px] rounded-[var(--radius-md)] border border-[var(--color-warn)] p-4 text-[14px] text-[var(--color-ink)]"
        >
          <p className="font-semibold">{LINK_COPY.brokenTitle}</p>
          <p className="mt-1 text-[var(--color-ink-muted)]">{LINK_COPY.brokenBody}</p>
        </div>
        <div className="flex max-w-[480px] flex-col gap-2">
          <p className="text-[13px] text-[var(--color-ink-muted)]">{LINK_COPY.getCodeHint}</p>
          <External href={links.getCode}>{LINK_COPY.getCode}</External>
        </div>
        {codeForm(LINK_COPY.linkAgainButton)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[60ch] text-[15px] text-[var(--color-ink)]">{LINK_COPY.intro}</p>
      <div className="flex max-w-[480px] flex-col gap-2">
        <p className="text-[13px] text-[var(--color-ink-muted)]">{LINK_COPY.getCodeHint}</p>
        <External href={links.getCode}>{LINK_COPY.getCode}</External>
      </div>
      {codeForm(LINK_COPY.linkButton)}
    </div>
  );
}
