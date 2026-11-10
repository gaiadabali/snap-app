import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditDocument } from '@/api';
import { Button, Card, Screen, ScreenHeader, Small } from '@/components/ui';
import { numeric, space, type, usePalette } from '@/theme';

/**
 * A receipt, tax invoice, adjustment note or refund receipt for a credit
 * purchase (7.7.b). Every word comes from the server (`GET
 * /v1/credits/documents/:id`), so the phone cannot show an ABN or a GST line a
 * document does not carry. "Share" sends the same text out as plain text, which
 * any mail or messaging app takes; the printable page is on the website.
 */
export default function ReceiptScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<CreditDocument | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void api()
      .getCreditDocument(id)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc(null));
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title={doc?.title ?? 'Receipt'} onBack={() => router.back()} />

        {doc === undefined ? <Small>Loading…</Small> : null}
        {doc === null ? <Small>That document is not available.</Small> : null}

        {doc ? (
          <>
            <Card>
              <View style={{ gap: space.sm }}>
                <Text style={[type.label, { color: p.inkMuted }]}>
                  No. {doc.number} · {doc.issuedOn}
                </Text>
                {doc.reference ? <Text style={[type.body, { color: p.inkMuted }]}>{doc.reference}</Text> : null}
                {doc.issuer ? (
                  <View style={{ gap: 2 }}>
                    <Text style={[type.bodyStrong, { color: p.ink }]}>{doc.issuer.legalName}</Text>
                    {doc.issuer.abn ? <Text style={[type.body, { color: p.ink }]}>ABN {doc.issuer.abn}</Text> : null}
                    <Text style={[type.body, { color: p.ink }]}>{doc.issuer.address}</Text>
                    <Text style={[type.body, { color: p.ink }]}>{doc.issuer.email}</Text>
                  </View>
                ) : null}
              </View>
            </Card>

            <Card>
              <View style={{ gap: space.sm }}>
                <Text style={[type.label, { color: p.inkMuted }]}>Billed to</Text>
                <Text style={[type.bodyStrong, { color: p.ink }]}>{doc.buyer.name}</Text>
                {doc.buyer.email ? <Text style={[type.body, { color: p.ink }]}>{doc.buyer.email}</Text> : null}
              </View>
            </Card>

            <Card>
              <View style={{ gap: space.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.lg }}>
                  <Text style={[type.body, { color: p.ink, flex: 1 }]}>
                    {doc.item.description} × {doc.item.quantity}
                  </Text>
                  <Text style={[type.bodyStrong, numeric, { color: p.ink }]}>{doc.item.amount}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.lg }}>
                  <Text style={[type.bodyStrong, { color: p.ink }]}>Total</Text>
                  <Text style={[type.bodyStrong, numeric, { color: p.ink }]}>{doc.total}</Text>
                </View>
                {doc.gstStatement ? <Text style={[type.body, { color: p.inkMuted }]}>{doc.gstStatement}</Text> : null}
              </View>
            </Card>

            {doc.note ? <Small>{doc.note}</Small> : null}

            <Button
              label="Share"
              icon="receipt"
              tone="outline"
              onPress={() => void Share.share({ message: receiptText(doc) })}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The document as plain text, line for line what the screen shows. */
function receiptText(doc: CreditDocument): string {
  const lines = [`${doc.title} ${doc.number}`, doc.issuedOn];
  if (doc.reference) lines.push(doc.reference);
  if (doc.issuer) {
    lines.push('', doc.issuer.legalName);
    if (doc.issuer.abn) lines.push(`ABN ${doc.issuer.abn}`);
    lines.push(doc.issuer.address, doc.issuer.email);
  }
  lines.push('', `Billed to: ${doc.buyer.name}`);
  if (doc.buyer.email) lines.push(doc.buyer.email);
  lines.push('', `${doc.item.description} x ${doc.item.quantity}: ${doc.item.amount}`, `Total: ${doc.total}`);
  if (doc.gstStatement) lines.push(doc.gstStatement);
  return lines.join('\n');
}
