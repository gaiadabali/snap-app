/**
 * Marketing icon set.
 *
 * Hand-rolled inline SVGs rather than an icon-library dependency — this is a
 * handful of glyphs used deliberately, not a wall of decorative emoji (see
 * docs/WEB.md §4, "what reads as generic"). Stroke-based, single colour via
 * `currentColor` so they inherit tone from whatever wraps them and need no
 * separate dark-mode variant.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h1.34a1.5 1.5 0 0 0 1.28-.72l.76-1.26A1.5 1.5 0 0 1 10.16 4h3.68a1.5 1.5 0 0 1 1.28.72l.76 1.26a1.5 1.5 0 0 0 1.28.72H18.5A1.5 1.5 0 0 1 20 8.2v9.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 19 6v5.2c0 4.2-2.9 7.4-7 9.3-4.1-1.9-7-5.1-7-9.3V6Z" />
      <path d="m9 12 2.1 2.1L15.5 10" />
    </svg>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5v17" />
      <path d="M6.5 6.5h11" />
      <path d="m4 10.5 2.5-4 2.5 4a2.5 2.5 0 0 1-5 0Z" />
      <path d="m15 10.5 2.5-4 2.5 4a2.5 2.5 0 0 1-5 0Z" />
      <path d="M8.5 20.5h7" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M11.6 3.5H6a2.5 2.5 0 0 0-2.5 2.5v5.6c0 .4.16.78.44 1.06l8.9 8.9a1.5 1.5 0 0 0 2.12 0l6.04-6.04a1.5 1.5 0 0 0 0-2.12l-8.9-8.9a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.2" cy="8.2" r="1.2" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4 21 19.5H3Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.15" fill="currentColor" stroke="none" />
      <path d="M12 16.85v.3" strokeWidth={2.4} />
    </svg>
  );
}

export function SplitIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h4.5l4 12h7" />
      <path d="M4 18h4.5l1.6-4.8" />
      <path d="m16.5 4 3.5 3-3.5 3" />
    </svg>
  );
}

export function FolderCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7.2A1.7 1.7 0 0 1 5.7 5.5h3.6l1.6 2h7.4A1.7 1.7 0 0 1 20 9.2v8.1a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.3Z" />
      <path d="m9 14 2 2 4-4.2" />
    </svg>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5" />
      <path d="M17 3.5v3.4h-3.4" />
      <path d="M7 20.5v-3.4h3.4" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2Z" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h15.5" />
      <path d="m14 6 6 6-6 6" />
    </svg>
  );
}
