import type { YourtalLinkStatus } from '@snap/api-contract';
import { Pressable, View } from 'react-native';

import { Field, Loading } from '@/components/form';
import { Body, Button, Card, Divider, Notice, SectionHeader, Small } from '@/components/ui';
import {
  LINK_COPY,
  cleanLinkCode,
  linkErrorMessage,
  linkedOn,
  otherRefused,
  type LinkContext,
} from '@/lib/yourtal-link';
import { Text } from '@/theme/text';
import { space, type, usePalette } from '@/theme';

/** What the screen knows. `ready` carries the server's answer untouched. */
export type LinkLoad =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; status: YourtalLinkStatus };

export interface YourtalLinkPanelProps {
  load: LinkLoad;
  /** Absolute YourTal URLs, built from `YOURTAL_WEB_URL`. */
  links: { getCode: string; wallet: string };
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
  onRetry: () => void;
  onOpenUrl: (url: string) => void;
  /** Goes to the existing email-confirmation flow (Settings). */
  onConfirmEmail: () => void;
}

/** A tappable line of text that leaves the screen. */
function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
    >
      <Text style={[type.bodyStrong, { color: p.accentText }]}>{label}</Text>
    </Pressable>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ paddingVertical: space.md, gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        <Body>{label}</Body>
        <Body strong>{value}</Body>
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}

function ErrorNotice({
  error,
  onConfirmEmail,
}: {
  error: NonNullable<YourtalLinkPanelProps['error']>;
  onConfirmEmail: () => void;
}) {
  const message = linkErrorMessage(error.code, error.context);
  return (
    <View style={{ gap: space.sm }}>
      <Notice tone="risk" icon="alert">
        {message.text}
      </Notice>
      {message.action === 'verify-email' ? (
        <LinkText label={LINK_COPY.confirmEmail} onPress={onConfirmEmail} />
      ) : null}
    </View>
  );
}

/**
 * The YourTal points link: one panel for every state (group plan 2.6).
 *
 * Controlled and free of data fetching, so each state renders from props
 * alone (`YourtalLinkPanel.test.tsx` renders them all). `app/points.tsx` owns
 * the loading, the calls and the navigation.
 *
 * Renders NOTHING when the server says `available: false`: that is a server
 * without YourTal credentials, and a screen offering a link that cannot work
 * is worse than none.
 */
export function YourtalLinkPanel(props: YourtalLinkPanelProps) {
  const { load, links, code, busy, error } = props;

  if (load.kind === 'loading') {
    return (
      <View accessibilityLabel="Loading your YourTal link">
        <Loading />
      </View>
    );
  }

  if (load.kind === 'error') {
    return (
      <View style={{ gap: space.md }}>
        <Notice tone="risk" icon="alert">
          {LINK_COPY.loadError}
        </Notice>
        <Button label={LINK_COPY.retry} tone="outline" onPress={props.onRetry} />
      </View>
    );
  }

  const { status } = load;
  if (!status.available) return null;

  const codeForm = (buttonLabel: string) => (
    <View style={{ gap: space.md }}>
      <Field
        label={LINK_COPY.codeLabel}
        value={code}
        onChangeText={props.onCodeChange}
        placeholder={LINK_COPY.codePlaceholder}
        autoCapitalize="characters"
        autoComplete="off"
      />
      {error && error.context === 'link' ? (
        <ErrorNotice error={error} onConfirmEmail={props.onConfirmEmail} />
      ) : null}
      <Button
        label={buttonLabel}
        busy={busy === 'link'}
        disabled={cleanLinkCode(code) === ''}
        onPress={() => props.onLink(cleanLinkCode(code))}
      />
    </View>
  );

  if (status.state === 'linked') {
    const since = linkedOn(status.linkedAt);
    return (
      <View style={{ gap: space.xl }}>
        {status.receiptPoints?.state === 'paused' ? (
          <Notice tone="warn" icon="alert">
            {`${LINK_COPY.pausedTitle} ${LINK_COPY.pausedBody}`}
          </Notice>
        ) : null}
        <Card tone="good">
          <View style={{ gap: space.xs }}>
            <Body strong>{LINK_COPY.linkedTitle}</Body>
            {since ? <Small>{`Since ${since}`}</Small> : null}
          </View>
        </Card>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Your receipts" />
          <Card padded={false} style={{ paddingHorizontal: space.lg }}>
            <StatRow label={LINK_COPY.rowRewarded} value={status.receipts.rewarded.toLocaleString('en-AU')} />
            <Divider />
            <StatRow label={LINK_COPY.rowPending} value={status.receipts.pending.toLocaleString('en-AU')} />
            <Divider />
            <StatRow
              label={LINK_COPY.rowDuplicate}
              value={status.receipts.skippedDuplicate.toLocaleString('en-AU')}
              hint={LINK_COPY.duplicateHint}
            />
            <Divider />
            <StatRow
              label={LINK_COPY.rowFree}
              value={status.receipts.skippedFree.toLocaleString('en-AU')}
              hint={LINK_COPY.freeHint}
            />
            {status.receipts.pausedRefused > 0 ? (
              <>
                <Divider />
                <StatRow
                  label={LINK_COPY.rowPaused}
                  value={status.receipts.pausedRefused.toLocaleString('en-AU')}
                  hint={LINK_COPY.pausedHint}
                />
              </>
            ) : null}
            {otherRefused(status.receipts) > 0 ? (
              <>
                <Divider />
                <StatRow
                  label={LINK_COPY.rowRefused}
                  value={otherRefused(status.receipts).toLocaleString('en-AU')}
                  hint={LINK_COPY.refusedHint}
                />
              </>
            ) : null}
            <Divider />
            <StatRow label={LINK_COPY.rowPoints} value={status.pointsReported.toLocaleString('en-AU')} />
          </Card>
          <Small>{LINK_COPY.linkedHint}</Small>
          <LinkText label={LINK_COPY.openWallet} onPress={() => props.onOpenUrl(links.wallet)} />
        </View>

        {error && error.context === 'unlink' ? (
          <ErrorNotice error={error} onConfirmEmail={props.onConfirmEmail} />
        ) : null}

        {props.confirming ? (
          <Card tone="warn">
            <View style={{ gap: space.md }}>
              <Body strong>{LINK_COPY.unlinkConfirmTitle}</Body>
              <Small>{LINK_COPY.unlinkConfirmBody}</Small>
              <Button
                label={LINK_COPY.unlinkConfirmButton}
                tone="risk"
                busy={busy === 'unlink'}
                onPress={props.onConfirmUnlink}
              />
              <Button
                label={LINK_COPY.unlinkCancelButton}
                tone="outline"
                disabled={busy === 'unlink'}
                onPress={props.onCancelUnlink}
              />
            </View>
          </Card>
        ) : (
          <Button label={LINK_COPY.unlinkButton} tone="outline" onPress={props.onAskUnlink} />
        )}
      </View>
    );
  }

  if (status.state === 'broken') {
    return (
      <View style={{ gap: space.xl }}>
        <Notice tone="warn" icon="alert">
          {`${LINK_COPY.brokenTitle}. ${LINK_COPY.brokenBody}`}
        </Notice>
        <Small>{LINK_COPY.getCodeHint}</Small>
        <LinkText label={LINK_COPY.getCode} onPress={() => props.onOpenUrl(links.getCode)} />
        {codeForm(LINK_COPY.linkAgainButton)}
      </View>
    );
  }

  return (
    <View style={{ gap: space.xl }}>
      <Body>{LINK_COPY.intro}</Body>
      <View style={{ gap: space.sm }}>
        <Small>{LINK_COPY.getCodeHint}</Small>
        <LinkText label={LINK_COPY.getCode} onPress={() => props.onOpenUrl(links.getCode)} />
      </View>
      {codeForm(LINK_COPY.linkButton)}
    </View>
  );
}
