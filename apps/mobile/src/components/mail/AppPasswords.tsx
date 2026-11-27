import type { MailAppPassword, MailAppPasswordCreated } from '@snap/api-contract';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { api } from '@/api';
import { Field, Loading } from '@/components/form';
import { Body, Button, Card, Chip, Divider, Label, Notice, Small } from '@/components/ui';
import { bridgeErrorMessage, dayDate } from '@/lib/mail-format';
import { APP_PASSWORD_NAME_MAX, MAX_APP_PASSWORDS } from '@/lib/mail-files';
import { space, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { CopyButton } from './CopyButton';
import { ErrorBlock } from './MailUi';

const security = (s: string) => (s === 'ssl' ? 'SSL/TLS' : s);

function Detail({ label, value, mono = false, copy }: { label: string; value: string; mono?: boolean; copy?: string }) {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space.sm, gap: 2 }}>
      <Label>{label}</Label>
      <Text selectable style={{ color: p.ink, fontSize: 15, lineHeight: 21, fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </Text>
      {copy ? <CopyButton text={copy} label={`Copy ${label.toLowerCase()}`} /> : null}
    </View>
  );
}

/** What a phone mail app needs, shown once when the password is created. */
export function AppPasswordSecret({ created, onDone }: { created: MailAppPasswordCreated; onDone: () => void }) {
  return (
    <Card tone="accent" style={{ gap: space.sm }}>
      <Body strong>App password for “{created.name}”</Body>
      <Body>
        Copy it now. <Text style={{ fontWeight: '700' }}>This is the only time you will see this password.</Text> If you lose it,
        revoke it and make a new one.
      </Body>
      <Card tone="ground" padded={false} style={{ paddingHorizontal: space.md }}>
        <Detail label="Password" value={created.secret} mono copy={created.secret} />
        <Divider />
        <Detail label="Username" value={created.username} mono copy={created.username} />
        <Divider />
        <Detail
          label="Incoming (IMAP)"
          value={`${created.imap.host} · port ${created.imap.port} · ${security(created.imap.security)}`}
          copy={created.imap.host}
        />
        <Divider />
        <Detail
          label="Outgoing (SMTP)"
          value={`${created.smtp.host} · port ${created.smtp.port} · ${security(created.smtp.security)}`}
          copy={created.smtp.host}
        />
      </Card>
      <Small>Use your full address as the username in both.</Small>
      <Button label="I have copied it" onPress={onDone} />
    </Card>
  );
}

/**
 * Passwords that let a phone mail app (Gmail, Apple Mail, Outlook) read this inbox. Each is
 * separate from how the person signs in, shown once, and revoked in one tap. A mail token
 * cannot create one: only the person's own session can (spambank/BUILD.md §4.10).
 */
export function AppPasswords() {
  const [items, setItems] = useState<MailAppPassword[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<MailAppPasswordCreated | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await api().listMailAppPasswords());
    } catch (e) {
      setLoadError(bridgeErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const trimmed = name.trim();
    if (trimmed === '') return setProblem('Give it a name, such as “Pixel mail”.');
    setCreating(true);
    setProblem(null);
    try {
      const made = await api().createMailAppPassword(trimmed);
      setCreated(made);
      setName('');
      setItems((cur) => [...(cur ?? []), { id: made.id, name: made.name, createdAt: made.createdAt }]);
    } catch (e) {
      setProblem(bridgeErrorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(item: MailAppPassword) {
    setRevoking(item.id);
    setProblem(null);
    try {
      await api().revokeMailAppPassword(item.id);
      setItems((cur) => (cur ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      setProblem(bridgeErrorMessage(e));
    } finally {
      setRevoking(null);
    }
  }

  const confirmRevoke = (item: MailAppPassword) =>
    Alert.alert(`Revoke “${item.name}”?`, 'The phone using it will stop receiving mail.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => void revoke(item) },
    ]);

  const full = (items?.length ?? 0) >= MAX_APP_PASSWORDS;

  return (
    <View style={{ gap: space.md }}>
      {created ? <AppPasswordSecret created={created} onDone={() => setCreated(null)} /> : null}

      {loadError ? (
        <ErrorBlock message={loadError} onRetry={() => void load()} />
      ) : items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Small>No app passwords yet.</Small>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {items.map((i, at) => (
            <View key={i.id}>
              {at === 0 ? null : <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Body strong numberOfLines={1}>
                    {i.name}
                  </Body>
                  <Small>Created {dayDate(i.createdAt)}</Small>
                </View>
                <Button
                  label="Revoke"
                  tone="outline"
                  busy={revoking === i.id}
                  onPress={() => confirmRevoke(i)}
                  style={{ minHeight: 44, paddingHorizontal: space.lg }}
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      {problem ? (
        <Notice tone="risk" icon="alert">
          {problem}
        </Notice>
      ) : null}

      {full ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Chip tone="warn">Limit reached</Chip>
          <Small style={{ flex: 1 }}>You can have up to {MAX_APP_PASSWORDS} app passwords. Revoke one to make another.</Small>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Field
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v.slice(0, APP_PASSWORD_NAME_MAX));
              setProblem(null);
            }}
            placeholder="Pixel mail"
            autoCapitalize="words"
            autoComplete="off"
          />
          <Button
            label={creating ? 'Creating…' : 'Create app password'}
            tone="outline"
            busy={creating}
            disabled={name.trim() === ''}
            onPress={() => void create()}
          />
        </View>
      )}
    </View>
  );
}
