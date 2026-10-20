import type { SVGProps } from 'react';

/**
 * One stroke icon set for the marketing site AND the coded app screens.
 *
 * 24-unit grid, 1.8 stroke, round caps — the same construction as the phone
 * app's own `components/Icon.tsx`, so a glyph drawn inside a phone mockup and
 * the same glyph on the page around it are visibly one family.
 *
 * Decorative by default (`aria-hidden`). Pass `title` when an icon is the
 * only thing carrying meaning, and it becomes an image with that name.
 */
const PATHS = {
  home: 'M3.5 10.5 12 3.8l8.5 6.7V20a1 1 0 0 1-1 1h-5v-6.5h-5V21h-5a1 1 0 0 1-1-1z',
  wallet:
    'M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A1.5 1.5 0 0 0 5.5 9H19a1 1 0 0 1 1 1v3m0 0h-4a1.5 1.5 0 0 0 0 3h4m0-3v3',
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  receipt:
    'M6 3.5h12V21l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21zM9 8h6M9 11.5h6M9 15h3.5',
  chart: 'M4 20h16M7 20v-6M11.5 20V9M16 20v-9.5M20.5 20V6',
  target:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.8a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z',
  repeat: 'M17 3.5 20 6.5l-3 3M20 6.5H8a4 4 0 0 0-4 4V12M7 20.5 4 17.5l3-3M4 17.5h12a4 4 0 0 0 4-4V12',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0zM8 8.5h.01',
  check: 'M5 12.5 9.5 17 19 7.5',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.3l2.7 2.7L16.2 9.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 3.8 21.2 19.5H2.8zM12 10v4.2M12 17.2h.01',
  shield: 'M12 3 19.5 6v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM8.8 12.2l2.2 2.2 4.4-4.6',
  lock: 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5',
  camera:
    'M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2.3l1.5-2.2h5.4l1.5 2.2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-up-right': 'M7 17 17 7M8.5 7H17v8.5',
  sparkle: 'M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z',
  users:
    'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.8 20c.9-3.2 3.3-5 6.2-5s5.3 1.8 6.2 5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 15.2c1.6.7 2.7 2.3 3.2 4.8',
  file: 'M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8zM14 3.5V8h4.5M9 13h6M9 16.5h4',
  search: 'M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4zM16 16l4.5 4.5',
  'chevron-right': 'M9.5 5.5 16 12l-6.5 6.5',
  'chevron-down': 'M5.5 9.5 12 16l6.5-6.5',
  'chevron-left': 'M14.5 5.5 8 12l6.5 6.5',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  phone: 'M8 2.8h8a1.5 1.5 0 0 1 1.5 1.5v15.4a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V4.3A1.5 1.5 0 0 1 8 2.8zM10.5 18h3',
  'cloud-off':
    'M3.5 3.5l17 17M8.3 6.4A6 6 0 0 1 17.6 10h.4a3.5 3.5 0 0 1 2.4 6.1M16 18.5H7a4 4 0 0 1-.9-7.9',
  bolt: 'M13 2.8 5 13.5h6l-1 7.7 8-10.7h-6z',
  layers: 'M12 3.5 21 8.2 12 13 3 8.2zM3 12.4l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8',
  calendar: 'M5.5 5.5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zM4.5 10h15M8.5 3.5v4M15.5 3.5v4',
  fuel: 'M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15.5M3.5 20.5h12M5 10h9M14 8.5l3 2.5v6.5a1.5 1.5 0 0 0 3 0V9l-3-3',
  cart: 'M3 4h2.2l2.3 11h10.3l2-7.5H6.3M9.5 19.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16.5 19.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  coffee: 'M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5v2.5M11.5 3.5v2.5',
  tool: 'M14.5 6.5a4 4 0 0 1 5.3 5L21 12.7 18.2 15.5l-1.2-1.2a4 4 0 0 1-5-5.3L4.5 16.5l3 3L15 12',
  bank: 'M3.5 9.5 12 4l8.5 5.5M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20h17',
  star: 'M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5zM10 21h4',
  database: 'M12 8.5c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  'git-branch': 'M6.5 3.5v13M6.5 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 9.5c0 4.5-6 4-11 7',
  quote: 'M9.5 7H6a1.5 1.5 0 0 0-1.5 1.5V12A1.5 1.5 0 0 0 6 13.5h2.5c0 2-1 3.5-3 4M19 7h-3.5a1.5 1.5 0 0 0-1.5 1.5V12a1.5 1.5 0 0 0 1.5 1.5H18c0 2-1 3.5-3 4',
  'external': 'M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 3.9M12 17.2h.01',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  title,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number; title?: string } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  const fillShapes = name === 'play' || name === 'star' || name === 'bolt' || name === 'sparkle';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} fill={fillShapes && rest.fill ? rest.fill : 'none'} />
    </svg>
  );
}

/**
 * The Snap Apps mark — the app icon itself: a viewfinder around an S on the
 * brand gradient. Drawn as SVG so it is sharp at 24px in the header and at
 * 120px in the final call to action; the corner brackets are the camera's
 * framing guides, the same ones the capture screen shows.
 */
export function SnapMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
    >
      <defs>
        <linearGradient id="snapmark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E9DE0" />
          <stop offset="1" stopColor="#1F72C2" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#snapmark-g)" />
      <g fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 20.5v-5a2.5 2.5 0 0 1 2.5-2.5h5" />
        <path d="M43.5 13h5a2.5 2.5 0 0 1 2.5 2.5v5" />
        <path d="M51 43.5v5a2.5 2.5 0 0 1-2.5 2.5h-5" />
        <path d="M20.5 51h-5a2.5 2.5 0 0 1-2.5-2.5v-5" />
      </g>
      <path
        fill="#fff"
        d="M38.9 23.4c-1.9-1-3.9-1.6-5.9-1.6-1.6 0-2.6.6-2.6 1.6 0 1 .9 1.5 3.3 2.5 4 1.6 6 3.6 6 6.9 0 4.3-3.4 6.9-8.6 6.9-2.8 0-5.2-.6-6.9-1.4v-5.2c2 1.4 4.3 2.2 6.4 2.2 1.8 0 2.8-.6 2.8-1.7 0-1-.8-1.6-3.3-2.6-3.9-1.5-5.9-3.6-5.9-6.8 0-4.1 3.3-6.7 8.2-6.7 2.6 0 4.6.4 6.5 1.1z"
      />
    </svg>
  );
}
