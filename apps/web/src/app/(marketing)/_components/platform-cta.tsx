import Link from 'next/link';

import { cx } from '@/design/primitives';

/**
 * The get-the-app call to action — a store badge, in this site's own language.
 *
 * WHY IT IS NOT A STORE BADGE IMAGE. Every app landing page reaches for the
 * Google Play and App Store artwork, and both are unavailable to us twice
 * over: there is no Play listing yet (so the badge would be a link to
 * nothing), and `docs/DESIGN-HANDOFF.md` §12.2 permits exactly two kinds of
 * imagery on this site — app screenshots and the document itself. A pasted
 * store badge is neither.
 *
 * So the badge is typographic: platform, action, and the facts that decide
 * whether someone can install it. That is the same information the real
 * badges carry, set in the face the rest of the site already uses.
 *
 * ── The unavailable state ────────────────────────────────────────────────
 *
 * `href` omitted renders the control as present, focusable and announced as
 * unavailable — never as a disabled button and never as an `<a>` without an
 * href. `docs/WEB.md` §7 sets that contract and `download/inert-control.tsx`
 * explains it at length: a disabled button leaves the accessibility tree
 * entirely, so a screen reader user never learns the iPhone build exists,
 * which is precisely the audience the iOS section is written for.
 *
 * Both states are server-rendered with no JavaScript, so the iOS copy stays
 * crawlable — the SEO that section exists to build is the reason it is at
 * full weight while the build is still in progress.
 */
export function PlatformBadge({
  platform,
  action,
  note,
  href,
  tone = 'primary',
  className,
}: {
  /** ANDROID, IPHONE — the platform, not the product. */
  platform: string;
  /** What pressing it does: "Download the APK". */
  action: string;
  /** The facts under it: version and size, or why it cannot be pressed. */
  note: string;
  /** Omit to render the unavailable state. */
  href?: string;
  tone?: 'primary' | 'secondary';
  className?: string;
}) {
  const shell =
    'flex min-w-0 flex-col justify-center rounded-[var(--radius-md)] px-5 py-3 text-left transition-colors duration-150';

  const skin =
    tone === 'primary'
      ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-deep)]'
      : 'border border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)]';

  const label = (
    <>
      <span
        className={cx(
          't-label',
          tone === 'primary' ? 'opacity-80' : 'text-[var(--color-ink-faint)]',
        )}
      >
        {platform}
      </span>
      <span className="mt-1 truncate text-[15px] font-semibold">{action}</span>
      <span
        className={cx(
          'mt-0.5 font-mono text-[11px] tabular',
          tone === 'primary' ? 'opacity-80' : 'text-[var(--color-ink-muted)]',
        )}
      >
        {note}
      </span>
    </>
  );

  if (!href) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-disabled="true"
        className={cx(
          shell,
          'cursor-not-allowed border-2 border-dashed border-[var(--color-rule-strong)] bg-[var(--color-surface-alt)] text-[var(--color-ink-faint)]',
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={cx(shell, skin, className)}>
      {label}
    </Link>
  );
}

/**
 * The pair, for a hero.
 *
 * DELIBERATELY TAKES NO RELEASE DATA. The obvious version of this reads the
 * manifest so the button can say "v0.1.0 · 50.4 MB" — and that would make
 * every page carrying it dynamic, because `getAndroidRelease()` fetches with
 * `cache: 'no-store'` (rightly: a cached manifest advertises the previous
 * build's checksum against the current download). Paying a render-time API
 * round trip on the home page, and taking on its failure mode there, to print
 * a version number nobody came to the home page for is a bad trade.
 *
 * So the badge sends people to `/download`, which is where the live figures,
 * the checksum and — the part that actually matters for a side-loaded APK —
 * the "allow installs from this browser" steps already are. Following a
 * Download link to a download page is also just what people expect.
 */
export function GetTheAppButtons({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3 sm:flex-row', className)}>
      <PlatformBadge
        platform="Android"
        action="Download the app"
        note="Direct APK · Android 8.0+"
        href="/download"
      />
      <PlatformBadge
        platform="iPhone"
        action="Coming to iOS"
        note="In development — not yet installable"
      />
    </div>
  );
}
