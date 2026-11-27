import { Linking, Modal, Pressable, View } from 'react-native';
import { Text } from '@/theme/text';

import { BrandMark } from '@/components/BrandLogo';
import { useDeviceInsets } from '@/components/device-insets';
import { Icon } from '@/components/Icon';
import { Body, Card, Figure, Small } from '@/components/ui';
import { GOD_BRANDS, switcherTiles, type SwitcherTile } from '@/lib/god-brands';
import { radius, space, usePalette } from '@/theme';

/**
 * The GOD app switcher on the phone (god TASKS 9.13): a bottom sheet with one tile per GOD brand
 * and the GOD link at the foot, opened from Settings. The brand list is `lib/god-brands`, a small
 * copy of https://god.gaiada.com/brands.json that CI checks for drift.
 *
 * - SnapApps (this app) is marked and not a link; YourTal and Free Tax Returns open in the browser;
 *   Spambank opens this app's own Mail screen, and is offered only on the signal that already lists
 *   Mail in the menu (`mailEntryListed`), so a teen never sees it.
 * - Plain links: no query string, nothing about the person, no tokens, no tracking.
 * - Back (the system gesture or button) closes the sheet; every row is at least 44 pt.
 */
const TAP = 44;
export const GOD_SHEET_TITLE = `${GOD_BRANDS.god.name} apps`;

/** The neutral stand-in for a brand's mark: its first letter. The real SVG marks are web-only for now. */
function LetterMark({ name }: { name: string }) {
  const p = usePalette();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.md,
        backgroundColor: p.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: p.inkStrong, fontSize: 18, fontWeight: '700' }}>{name.slice(0, 1)}</Text>
    </View>
  );
}

function TileRow({
  tile,
  onOpenUrl,
  onOpenRoute,
}: {
  tile: SwitcherTile;
  onOpenUrl: (url: string) => void;
  onOpenRoute: (route: string) => void;
}) {
  const p = usePalette();
  const body = (
    <>
      {tile.key === 'snapapp' ? <BrandMark size={40} /> : <LetterMark name={tile.name} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Body strong>{tile.name}</Body>
        <Small>{tile.purpose}</Small>
      </View>
    </>
  );
  const row = {
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  };
  if (tile.current) {
    return (
      <View
        accessible
        accessibilityLabel={`${tile.name}, ${tile.purpose}. You are here.`}
        accessibilityState={{ selected: true }}
        style={[row, { backgroundColor: p.accentSoft }]}
      >
        {body}
        <Small>You are here</Small>
      </View>
    );
  }
  const external = tile.url !== null;
  return (
    <Pressable
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={`${tile.name}, ${tile.purpose}${external ? '. Opens in your browser.' : ''}`}
      onPress={() => (tile.url ? onOpenUrl(tile.url) : tile.route ? onOpenRoute(tile.route) : undefined)}
      style={({ pressed }) => [row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** The sheet's content, from props alone (the Modal around it adds nothing a render test could check). */
export function GodSwitcherContent({
  adultBrands,
  onOpenUrl,
  onOpenRoute,
  onClose,
}: {
  adultBrands: boolean;
  onOpenUrl: (url: string) => void;
  onOpenRoute: (route: string) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Figure size="h2">{GOD_SHEET_TITLE}</Figure>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => ({
            width: TAP,
            height: TAP,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="close" size={22} color={p.inkStrong} />
        </Pressable>
      </View>
      {switcherTiles({ adultBrands }).map((t) => (
        <TileRow key={t.key} tile={t} onOpenUrl={onOpenUrl} onOpenRoute={onOpenRoute} />
      ))}
      <View style={{ height: 1, backgroundColor: p.rule, marginTop: space.xs }} />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${GOD_BRANDS.god.label}. About ${GOD_BRANDS.god.name}. Opens in your browser.`}
        onPress={() => onOpenUrl(GOD_BRANDS.god.url)}
        style={({ pressed }) => ({
          minHeight: TAP,
          justifyContent: 'center',
          paddingHorizontal: space.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Body strong style={{ color: p.accentText }}>
          {GOD_BRANDS.god.label}
        </Body>
      </Pressable>
    </View>
  );
}

export function GodSwitcherSheet({
  open,
  adultBrands,
  onOpenRoute,
  onClose,
}: {
  open: boolean;
  adultBrands: boolean;
  onOpenRoute: (route: string) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const insets = useDeviceInsets();
  if (!open) return null;
  return (
    // onRequestClose is the Android back button and the system back gesture.
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: p.overlay }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: p.ground,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingTop: space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.lg,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: p.ruleStrong,
              marginBottom: space.sm,
            }}
          />
          <GodSwitcherContent
            adultBrands={adultBrands}
            onClose={onClose}
            onOpenRoute={(r) => {
              onClose();
              onOpenRoute(r);
            }}
            onOpenUrl={(u) => {
              onClose();
              void Linking.openURL(u);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Settings, "About GOD": the "A GOD company" link and the way into the sheet. Presentational;
 * Settings owns the sheet's state and opens the URL.
 */
export function GodAboutCard({ onOpenSwitcher, onOpenGod }: { onOpenSwitcher: () => void; onOpenGod: () => void }) {
  const p = usePalette();
  const row = ({ pressed }: { pressed: boolean }) => ({
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    opacity: pressed ? 0.6 : 1,
  });
  const host = GOD_BRANDS.god.url.replace('https://', '');
  return (
    <Card style={{ gap: space.sm }}>
      <Body>
        SnapApps is part of {GOD_BRANDS.god.name} ({GOD_BRANDS.god.fullName}), with YourTal, Free Tax Returns and
        Spambank.
      </Body>
      <View style={{ height: 1, backgroundColor: p.rule }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${GOD_SHEET_TITLE}. Open the list.`}
        onPress={onOpenSwitcher}
        style={row}
      >
        <Icon name="grid" size={22} color={p.inkStrong} />
        <View style={{ flex: 1 }}>
          <Body strong>{GOD_SHEET_TITLE}</Body>
          <Small>Go to our other apps</Small>
        </View>
        <Icon name="chevronRight" size={20} color={p.inkMuted} />
      </Pressable>
      <View style={{ height: 1, backgroundColor: p.rule }} />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${GOD_BRANDS.god.label}. Opens ${host} in your browser.`}
        onPress={onOpenGod}
        style={row}
      >
        <Icon name="link" size={22} color={p.inkStrong} />
        <View style={{ flex: 1 }}>
          <Body strong style={{ color: p.accentText }}>
            {GOD_BRANDS.god.label}
          </Body>
          <Small>{host}</Small>
        </View>
      </Pressable>
    </Card>
  );
}
