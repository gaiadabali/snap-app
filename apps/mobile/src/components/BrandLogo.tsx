import { Image, type StyleProp, type ImageStyle } from 'react-native';

import lockup from '../../assets/brand/snapapp-lockup.png';
import mark from '../../assets/brand/snapapp-mark.png';

/**
 * The official Snap Apps logo (owner's artwork, 2026-11-27), as the brand
 * guide uses it: the primary lockup first, the submark where space is tight.
 * The files are the owner's PNG traced to SVG and re-rendered, never
 * stretched, recoloured or given effects; the white behind the shutter
 * cut-outs is part of the asset, so it reads the same on light and dark.
 *
 * Guide minimums (p9): lockup 120 px wide, submark alone 24 px. Both clamp.
 */
const LOCKUP_RATIO = 1392 / 471;

export function BrandLockup({ width = 168, style }: { width?: number; style?: StyleProp<ImageStyle> }) {
  const w = Math.max(120, width);
  return (
    <Image
      source={lockup}
      accessibilityRole="image"
      accessibilityLabel="SnapApps"
      style={[{ width: w, height: Math.round(w / LOCKUP_RATIO) }, style]}
      resizeMode="contain"
    />
  );
}

export function BrandMark({ size = 40, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  const s = Math.max(24, size);
  return (
    <Image
      source={mark}
      accessibilityRole="image"
      accessibilityLabel="SnapApps"
      style={[{ width: s, height: s }, style]}
      resizeMode="contain"
    />
  );
}
