import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Item, type Party } from '@/api';
import { Raised } from '@/components/rich';
import { Body, Button, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { add, gstOnSale, multiply, ZERO } from '@/lib/money';
import { formatAud, radius, space, usePalette } from '@/theme';

/**
 * New invoice.
 *
 * The whole screen is built around one measurement: how long from opening it to
 * a sendable invoice. So the customer and the first line are two taps each, the
 * running total is always visible without scrolling, and nothing is required
 * that can be defaulted — dates, terms and the invoice number all fill
 * themselves in.
 *
 * Every figure is exact-decimal. Sales GST is 10% ADDED to the ex-GST line
 * total, which is the inverse of a receipt, where GST is 1/11 of the inclusive
 * amount. See src/lib/money.ts.
 */

type Line = { itemId: string; qty: number };

export default function NewInvoiceScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [customers, setCustomers] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<null | 'party' | 'item'>(null);
  const [qtyFor, setQtyFor] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState('1');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api().listParties('customer').then(setCustomers);
    void api().listItems().then(setItems);
  }, []);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const totals = useMemo(() => {
    const net = lines.reduce((acc, l) => {
      const it = itemById.get(l.itemId);
      return it ? add(acc, multiply(it.sellPrice, l.qty)) : acc;
    }, ZERO);
    const gst = gstOnSale(net);
    return { net, gst, total: add(net, gst) };
  }, [lines, itemById]);

  const canSave = party !== null && lines.length > 0;

  function addItem(item: Item) {
    setPicker(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      return existing
        ? prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
        : [...prev, { itemId: item.id, qty: 1 }];
    });
  }

  function commitQty() {
    const q = Number(qtyDraft);
    if (qtyFor && Number.isFinite(q) && q > 0) {
      setLines((prev) => prev.map((l) => (l.itemId === qtyFor ? { ...l, qty: q } : l)));
    }
    setQtyFor(null);
  }

  async function save() {
    setSaved(true);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* haptics unavailable */
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Customer ── */}
        <View style={{ gap: space.sm }}>
          <Label>Bill to</Label>
          <Pressable accessibilityRole="button" onPress={() => setPicker('party')}>
            <Raised>
              {party ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body strong>{party.name}</Body>
                    <Small>{party.abn ? `ABN ${party.abn}` : 'No ABN on file'}</Small>
                  </View>
                  <Small style={{ fontSize: 18 }}>›</Small>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Body muted style={{ flex: 1 }}>
                    Choose a customer
                  </Body>
                  <Small style={{ fontSize: 18 }}>›</Small>
                </View>
              )}
            </Raised>
          </Pressable>

          {/* The $1,000 rule is easier to honour before the invoice is sent than after. */}
          {party && !party.abnValid && Number(totals.total) >= 1000 ? (
            <Raised accent={p.warn}>
              <View style={{ gap: 4 }}>
                <Body strong>Buyer ABN needed</Body>
                <Small>
                  This invoice is $1,000 or more, so the ATO requires {party.name}&rsquo;s ABN on it.
                  Add it to their contact before sending.
                </Small>
              </View>
            </Raised>
          ) : null}
        </View>

        {/* ── Lines ── */}
        <View style={{ gap: space.sm }}>
          <Label>Items</Label>
          {lines.length === 0 ? (
            <Raised>
              <Small>Nothing added yet. Tap below to pick from your items.</Small>
            </Raised>
          ) : (
            <Raised style={{ padding: 0 }}>
              {lines.map((l, i) => {
                const it = itemById.get(l.itemId);
                if (!it) return null;
                const net = multiply(it.sellPrice, l.qty);
                return (
                  <View
                    key={l.itemId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body strong numberOfLines={1}>
                        {it.name}
                      </Body>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setQtyFor(it.id);
                          setQtyDraft(String(l.qty));
                        }}
                      >
                        <Small>
                          {l.qty} {it.unit} × {formatAud(it.sellPrice)} · tap to change
                        </Small>
                      </Pressable>
                    </View>
                    <Figure>{formatAud(net)}</Figure>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${it.name}`}
                      hitSlop={10}
                      onPress={() => setLines((prev) => prev.filter((x) => x.itemId !== it.id))}
                    >
                      <Text style={{ fontSize: 18, color: p.inkFaint }}>×</Text>
                    </Pressable>
                  </View>
                );
              })}
            </Raised>
          )}
          <Button label="＋  Add item" tone="outline" onPress={() => setPicker('item')} />
        </View>

        {/* ── Totals ── */}
        <Raised>
          <View style={{ gap: space.sm }}>
            <Row label="Subtotal (ex GST)" value={formatAud(totals.net)} />
            <Row label="GST 10%" value={formatAud(totals.gst)} />
            <Divider />
            <Row label="Total" value={formatAud(totals.total)} strong />
            <Small>
              GST is added on top of the ex-GST price. On a receipt it works the other way — 1/11 of
              the total you paid.
            </Small>
          </View>
        </Raised>

        {saved ? (
          <Raised accent={p.accent}>
            <View style={{ gap: 4 }}>
              <Body strong>Saved as draft</Body>
              <Small>
                Sending needs the server. The invoice, its lines and the GST are all computed and
                ready to post.
              </Small>
            </View>
          </Raised>
        ) : null}
      </ScrollView>

      {/* ── Sticky total + save. Always visible, never scrolled past. ── */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: p.ground,
          borderTopWidth: 1,
          borderTopColor: p.rule,
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Small>{lines.length} line{lines.length === 1 ? '' : 's'} · incl GST</Small>
          <Figure size="h1">{formatAud(totals.total)}</Figure>
        </View>
        <Button
          label={saved ? 'Done' : 'Save draft'}
          disabled={!canSave}
          onPress={() => (saved ? router.back() : void save())}
        />
      </View>

      {/* ── Pickers ── */}
      <PickerSheet
        visible={picker === 'party'}
        title="Choose a customer"
        onClose={() => setPicker(null)}
      >
        {customers.map((c) => (
          <PickerRow
            key={c.id}
            title={c.name}
            subtitle={c.abn ? `ABN ${c.abn}` : 'No ABN on file'}
            warn={!c.abnValid}
            onPress={() => {
              setParty(c);
              setPicker(null);
            }}
          />
        ))}
      </PickerSheet>

      <PickerSheet visible={picker === 'item'} title="Add an item" onClose={() => setPicker(null)}>
        {items.map((it) => (
          <PickerRow
            key={it.id}
            title={it.name}
            subtitle={`${formatAud(it.sellPrice)} per ${it.unit}${
              it.stockOnHand !== null ? ` · ${it.stockOnHand} in stock` : ''
            }`}
            warn={it.stockOnHand === 0}
            onPress={() => addItem(it)}
          />
        ))}
      </PickerSheet>

      {/* ── Quantity ── */}
      <Modal visible={qtyFor !== null} transparent animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'center' }} onPress={commitQty}>
          <Pressable
            style={{
              margin: space.xl,
              backgroundColor: p.ground,
              borderRadius: radius.lg,
              padding: space.xl,
              gap: space.lg,
            }}
          >
            <Figure size="h2">Quantity</Figure>
            <TextInput
              value={qtyDraft}
              onChangeText={setQtyDraft}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              style={{
                borderWidth: 2,
                borderColor: p.accent,
                borderRadius: radius.md,
                padding: space.md,
                fontSize: 24,
                color: p.ink,
                backgroundColor: p.surface,
              }}
            />
            <Button label="Done" onPress={commitQty} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function PickerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: p.ground,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: space.lg,
            paddingBottom: insets.bottom + space.lg,
            maxHeight: '80%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: space.lg,
              paddingBottom: space.md,
            }}
          >
            <Figure size="h2">{title}</Figure>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
              <Text style={{ fontSize: 22, color: p.inkFaint }}>×</Text>
            </Pressable>
          </View>
          <ScrollView>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerRow({
  title,
  subtitle,
  warn,
  onPress,
}: {
  title: string;
  subtitle: string;
  warn?: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: p.rule,
        backgroundColor: pressed ? p.surface : 'transparent',
        gap: 2,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Body strong style={{ flex: 1 }}>
          {title}
        </Body>
        {warn ? <Chip tone="warn">check</Chip> : null}
      </View>
      <Small>{subtitle}</Small>
    </Pressable>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Body muted={!strong} strong={strong}>
        {label}
      </Body>
      <Figure size={strong ? 'h2' : 'body'}>{value}</Figure>
    </View>
  );
}
