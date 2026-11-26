import type { SVGProps } from 'react';

import { Icon, type IconName } from '@/design/site/icons';

/**
 * The few glyphs mail needs that the site kit's `Icon` does not have, drawn on the same
 * grid (24 units, 1.8 stroke, round caps) so they read as one family. The kit is
 * owner-edited, so these live beside the mail screens; `MailIcon` falls through to the
 * kit's own `Icon` for everything it already draws.
 */
const EXTRA = {
  inbox:
    'M3.5 13.5 6.2 5.8a1.5 1.5 0 0 1 1.4-1h8.8a1.5 1.5 0 0 1 1.4 1l2.7 7.7M3.5 13.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5M3.5 13.5h4.2l1 2.2h6.6l1-2.2h4.2',
  send: 'M20.5 3.5 10.5 13.5M20.5 3.5 14 20.5l-3.5-7-7-3.5z',
  paperclip:
    'M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
  trash:
    'M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v5.5M14 11v5.5',
  reply: 'M9.5 5 4 10.5 9.5 16M4 10.5h10a6 6 0 0 1 6 6V19',
  'reply-all': 'M7 6 2 11l5 5M12 6 7 11l5 5M7 11h8a5.5 5.5 0 0 1 5.5 5.5V19',
  forward: 'M14.5 5 20 10.5 14.5 16M20 10.5H10a6 6 0 0 0-6 6V19',
  edit: 'M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  key: 'M8.5 15.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 11.5h8.5M17.5 11.5V15M20.5 11.5V14',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  copy: 'M9 9h9.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5.5 15V5.5a1 1 0 0 1 1-1H15',
  folder: 'M3.5 7.5v10a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-7L10 5H5a1.5 1.5 0 0 0-1.5 1.5z',
} as const;

export type MailIconName = keyof typeof EXTRA | IconName;

export function MailIcon({
  name,
  size = 20,
  strokeWidth = 1.8,
  ...rest
}: { name: MailIconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  if (!(name in EXTRA)) return <Icon name={name as IconName} size={size} strokeWidth={strokeWidth} {...rest} />;
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
      aria-hidden
      focusable="false"
      {...rest}
    >
      <path d={EXTRA[name as keyof typeof EXTRA]} />
    </svg>
  );
}
