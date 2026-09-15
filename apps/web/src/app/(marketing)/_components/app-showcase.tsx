import Image from 'next/image';

import { Reveal, cx } from '@/design/primitives';

/**
 * Real screens from the real app.
 *
 * These are captured from `apps/mobile` running in its fixture-backed demo
 * mode (`IS_DEMO`), not mocked up in a design tool — so what a visitor sees on
 * this page is what they get after installing. The captures still carry the
 * app's own "Demo" badge, which is the honest thing to leave in: the figures
 * are generated, and the footer says so of every figure on this site.
 *
 * Re-capture with the script in docs/WEB.md §4.6 whenever the app's UI moves.
 */

export type AppScreen = {
  src: string;
  alt: string;
  label: string;
  caption: string;
};

export const APP_SCREENS: readonly AppScreen[] = [
  {
    src: '/screens/home.png',
    alt: 'Snap Apps home screen showing $18,409.91 captured this quarter, six receipts to check, and $177.15 of GST credits at risk.',
    label: 'Home',
    caption: 'What needs you, first. Six receipts to confirm and $177.15 of GST you cannot yet claim.',
  },
  {
    src: '/screens/tax.png',
    alt: 'Tax and BAS screen showing $177.15 of GST credits at risk, $1,476.70 claimable, and a $50,570 deduction estimate for a line-haul truck driver.',
    label: 'Tax & BAS',
    caption:
      'Your BAS position as it stands today — claimable, at risk, and an occupation-benchmarked deduction estimate.',
  },
  {
    src: '/screens/receipts.png',
    alt: 'Receipts list showing 80 receipts totalling $18,409.91, broken down by category with fuel, truck parts and accommodation.',
    label: 'Receipts',
    caption: 'Eighty dockets, sorted and categorised. The ones marked "Check" are the only ones you touch.',
  },
] as const;

/**
 * A restrained device frame.
 *
 * Deliberately not a photoreal iPhone with a notch and a glare gradient — a
 * thin bezel reads as "this is a phone screen" and then gets out of the way.
 */
export function PhoneFrame({
  screen,
  priority = false,
  className,
  sizes = '(max-width: 768px) 70vw, 300px',
}: {
  screen: AppScreen;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[1.75rem] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-ground)] p-1.5 shadow-[var(--shadow-lift)]',
        className,
      )}
    >
      <Image
        src={screen.src}
        alt={screen.alt}
        width={780}
        height={1688}
        sizes={sizes}
        priority={priority}
        className="h-auto w-full rounded-[1.4rem]"
      />
    </div>
  );
}

/**
 * The three screens, dealt in as the section enters view.
 *
 * On a narrow viewport this becomes a horizontal snap-scroller rather than a
 * stack — three stacked phones is a very long column on a handset, and a
 * swipe is the gesture someone is already making.
 */
export function AppScreens() {
  return (
    <div
      className={cx(
        'flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4',
        'md:grid md:grid-cols-3 md:gap-10 md:overflow-visible md:pb-0',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      {APP_SCREENS.map((screen, i) => (
        <Reveal key={screen.src} variant="deal" delay={i} className="min-w-[68%] snap-center md:min-w-0">
          <figure className="m-0">
            <PhoneFrame screen={screen} />
            <figcaption className="mt-5">
              <span className="t-label text-[var(--color-accent)]">{screen.label}</span>
              <span className="mt-2 block text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                {screen.caption}
              </span>
            </figcaption>
          </figure>
        </Reveal>
      ))}
    </div>
  );
}
