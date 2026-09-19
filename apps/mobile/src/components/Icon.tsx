import type { ColorValue } from 'react-native';
import Svg, { Path, Rect, type SvgProps } from 'react-native-svg';

import { usePalette } from '@/theme';

/**
 * The redesign's icon set, ported one-for-one from the `<symbol>` sheet in
 * "Snap Apps Prototype.dc.html".
 *
 * The prototype draws these as PNG masks tinted with `currentColor`. That
 * technique has no React Native equivalent that is worth having — `tintColor`
 * on an `<Image>` is Android-flaky and ships 40 raster files — so the same
 * geometry is expressed as vectors instead. The path data is copied verbatim;
 * only the delivery changed.
 *
 * Everything is drawn on a 24×24 box with a 1.75 stroke, round caps and round
 * joins, so icons stay optically consistent when they sit next to each other
 * in a row. A few glyphs override the weight where the prototype does.
 */

export type IconName =
  | 'home'
  | 'scan'
  | 'receipt'
  | 'user'
  | 'users'
  | 'search'
  | 'close'
  | 'plus'
  | 'chevronRight'
  | 'chevronLeft'
  | 'back'
  | 'chevronDown'
  | 'camera'
  | 'check'
  | 'target'
  | 'chart'
  | 'repeat'
  | 'wallet'
  | 'spark'
  | 'tag'
  | 'cog'
  | 'bell'
  | 'moon'
  | 'sun'
  | 'logout'
  | 'alert'
  | 'shield'
  | 'upload'
  | 'offline'
  | 'image'
  | 'help'
  | 'lock'
  | 'trash'
  | 'cart'
  | 'fork'
  | 'fuel'
  | 'bolt'
  | 'heart'
  | 'bag'
  | 'menu'
  | 'info'
  | 'calendar'
  | 'edit'
  | 'doc'
  | 'box'
  | 'grid'
  | 'report'
  | 'link'
  | 'building'
  | 'bank'
  | 'truck'
  | 'download'
  | 'road'
  | 'card'
  | 'star';

/** `d` attributes, in symbol-sheet order. A tuple means a heavier stroke. */
const PATHS: Record<IconName, string[] | { d: string[]; width: number }> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5'],
  scan: ['M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M6 12h12'],
  receipt: ['M5 3h14v18l-2.5-1.6L14 21l-2-1.6L10 21l-2.5-1.6L5 21Z', 'M9 8h6M9 12h4'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 21c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6'],
  users: [
    'M9.5 12a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z',
    'M2.5 20.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5',
    'M17 10.5a3 3 0 1 0 0-6',
    'M18.5 20.5H22c0-2.5-1.5-4.2-3.8-5',
  ],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.3-4.3'],
  close: { d: ['M6 6l12 12M18 6L6 18'], width: 1.9 },
  plus: { d: ['M12 5v14M5 12h14'], width: 1.9 },
  chevronRight: ['M9 5l7 7-7 7'],
  chevronLeft: ['M15 5l-7 7 7 7'],
  back: ['M19 12H5M11 6l-6 6 6 6'],
  chevronDown: ['M5 9l7 7 7-7'],
  camera: [
    'M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
    'M12 17a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z',
  ],
  check: { d: ['M4.5 12.5 9.5 17.5 20 6.5'], width: 2.1 },
  target: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M12 12.8a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Z',
  ],
  chart: ['M3 20h18', 'M6 20v-6M12 20V5M18 20v-9'],
  repeat: ['M4 11V9a3 3 0 0 1 3-3h10l-3-3', 'M20 13v2a3 3 0 0 1-3 3H7l3 3'],
  wallet: [
    'M3 8a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v2',
    'M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2',
    'M17 15h4v-4h-4a2 2 0 0 0 0 4Z',
  ],
  spark: ['M12 3.5l1.9 5.3 5.3 1.9-5.3 1.9L12 18l-1.9-5.4L4.8 10.7l5.3-1.9Z'],
  tag: ['M3 12.5V5a2 2 0 0 1 2-2h7.5L21 11.5 13 20Z', 'M7.8 7.8h.01'],
  cog: [
    'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z',
    'M12 2.5v2.6M12 18.9v2.6M4.3 4.3l1.9 1.9M17.8 17.8l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.3 19.7l1.9-1.9M17.8 6.2l1.9-1.9',
  ],
  bell: ['M6 10a6 6 0 0 1 12 0c0 4.6 2 5.8 2 5.8H4S6 14.6 6 10Z', 'M10 19.5a2 2 0 0 0 4 0'],
  moon: ['M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6Z'],
  sun: [
    'M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z',
    'M12 2.5v2M12 19.5v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2.5 12h2M19.5 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5',
  ],
  logout: ['M15 17l5-5-5-5', 'M20 12H9', 'M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6'],
  alert: ['M12 4 2.8 20h18.4Z', 'M12 10v4M12 17h.01'],
  shield: ['M12 3l8 3v6c0 5-3.5 8.3-8 9-4.5-.7-8-4-8-9V6Z', 'M9 12l2.2 2.2L15.5 10'],
  upload: ['M12 16V4M7.5 8.5 12 4l4.5 4.5', 'M4 20h16'],
  offline: ['M2 6c6-4 14-4 20 0M5.5 10c4-2.6 9-2.6 13 0M9 14c2-1.3 4-1.3 6 0M12 18.5h.01', 'M3 3l18 18'],
  image: ['M4 5h16v14H4Z', 'M4 16.5 8.5 12l4.5 4.5 3-3 4 4', 'M9 9.5h.01'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.6 9.4A2.5 2.5 0 1 1 12 12.2v1.4M12 17h.01'],
  lock: ['M5.5 11h13v9.5h-13Z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  trash: ['M4 7h16M9 7V4.5h6V7M6 7l1 13.5h10L18 7', 'M10 11v6M14 11v6'],
  cart: [
    'M3.5 5H6l2.2 9.5h9.4L19.5 8H7',
    'M10 19.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4ZM17 19.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z',
  ],
  fork: ['M7 3v7.5a2 2 0 0 0 4 0V3M9 12.5V21', 'M16.5 3c-1.6 1.6-1.6 4.4 0 6V21'],
  fuel: ['M6 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16M4.5 21h11M6.5 11h7', 'M15.5 9H17a2 2 0 0 1 2 2v4a1.3 1.3 0 0 0 2.5 0'],
  bolt: ['M13 2.5 5.5 13.5H11l-1 8 8-11h-5.5Z'],
  heart: ['M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20Z'],
  bag: ['M6 8h12l1 12.5H5Z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  menu: { d: ['M4 7h16M4 12h16M4 17h11'], width: 1.9 },
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5M12 8h.01'],
  calendar: ['M4 6.5h16V21H4Z', 'M4 11h16', 'M8.5 3.5v4M15.5 3.5v4'],

  /* Added for the menu, which the prototype renders with Material PNGs rather
     than its own symbol sheet. Drawn to the same 24-box / 1.75-stroke rules so
     they sit in a row with the ported ones without looking imported. */
  edit: ['M4 20h4L19 9l-4-4L4 16Z', 'M14.5 5.5 18.5 9.5'],
  doc: ['M6 3h8l4 4v14H6Z', 'M14 3v4h4', 'M9 13h6M9 17h4'],
  box: ['M12 3 3.5 7.5v9L12 21l8.5-4.5v-9Z', 'M3.5 7.5 12 12l8.5-4.5M12 12v9'],
  grid: ['M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z'],
  report: ['M12 3a9 9 0 1 0 9 9h-9Z', 'M14.5 3.5A9 9 0 0 1 20.5 9.5h-6Z'],
  link: ['M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5', 'M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5L12.5 17'],
  building: ['M5 21V4.5h9V21', 'M14 10h5v11', 'M8 8h3M8 12h3M8 16h3M17 14h0M17 18h0'],
  bank: ['M3.5 9.5 12 4l8.5 5.5', 'M5.5 9.5V18M10 9.5V18M14 9.5V18M18.5 9.5V18', 'M3.5 21h17'],
  truck: ['M2.5 6h11v10h-11Z', 'M13.5 9.5H17l3.5 3v3.5h-7', 'M7 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  download: ['M12 4v12M7.5 11.5 12 16l4.5-4.5', 'M4 20h16'],
  road: ['M8 3 5 21M16 3l3 18', 'M12 4v3M12 10.5v3M12 17v3'],
  card: ['M3 6h18v12H3Z', 'M3 10h18', 'M6.5 14.5h3'],
  star: ['M12 3.5l2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 17.2 6.5 20.2l1.3-6.1L3.2 9.9l6.2-.7Z'],
};

export function Icon({
  name,
  size = 22,
  color,
  ...rest
}: { name: IconName; size?: number; color?: ColorValue } & SvgProps) {
  const p = usePalette();
  const spec = PATHS[name];
  const paths = Array.isArray(spec) ? spec : spec.d;
  const strokeWidth = Array.isArray(spec) ? 1.75 : spec.width;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      {paths.map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color ?? p.ink}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/**
 * The battery/signal/wi-fi trio the prototype draws to fake a phone status bar.
 * A real device already has one, so these exist only for the tablet frame and
 * for screenshots taken on web — never over the top of a live status bar.
 */
export function StatusGlyphs({ color }: { color?: ColorValue }) {
  const p = usePalette();
  const c = color ?? p.ink;
  return (
    <Svg width={26} height={12} viewBox="0 0 26 12" fill="none">
      <Rect x={0.6} y={0.6} width={21} height={10.8} rx={3} stroke={c} strokeWidth={1.2} />
      <Path d="M23.5 4v4" stroke={c} strokeWidth={1.2} strokeLinecap="round" />
      <Rect x={2.4} y={2.4} width={14} height={7.2} rx={1.8} fill={c} />
    </Svg>
  );
}
