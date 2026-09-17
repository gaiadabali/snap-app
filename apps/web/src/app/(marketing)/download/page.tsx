import type { Metadata } from 'next';

import { PageHero, Reveal, Section, SectionHead, Tear } from '@/design/primitives';
import {
  IOS_NOTIFY_CONTACT,
  getAndroidRelease,
  getChangelog,
  getRelease,
  getSystemRequirements,
} from '@/lib/releases';

import { PageSpine } from '../_components/page-spine';
import { ReleaseBlock, ReleaseCard, SpecRow } from '../_components/release-card';
import { CopyableChecksum } from './copyable-checksum';
import { InertDownloadControl } from './inert-control';

const PUBLIC_URL = process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000';
const PAGE_URL = `${PUBLIC_URL}/download`;

const TITLE = 'Download Snap Apps for Android and iPhone (iOS in development)';
const DESCRIPTION =
  'Get the Snap Apps Android APK today, with a verifiable SHA-256 checksum and step-by-step install instructions. The iPhone (iOS) app is in active development — see what it will do and get notified at launch.';

export const metadata: Metadata = {
  title: 'Download',
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    siteName: 'Snap Apps',
    type: 'website',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const ANDROID_STEPS = [
  {
    title: 'Allow installs from this browser',
    body: 'When the download finishes, Android will warn that it blocks installs from unknown sources. Tap Settings on that warning, then turn on "Allow from this source" for your browser. You only do this once.',
  },
  {
    title: 'Open the downloaded file',
    body: 'Find "Snap Apps" in your Downloads or notification shade and tap it. Android will show the permissions the app asks for — camera, for photographing receipts — then tap Install.',
  },
  {
    title: '(Optional) check the file is exactly what we built',
    body: "If your file manager can show a file's SHA-256, compare it to the checksum below before installing. They should match exactly. If you don't know how to do this, it's fine to skip — most people do.",
  },
];

const IOS_FEATURES = [
  'Photograph a receipt, get a categorised, GST-aware line item',
  'Realtime extraction on the paid plans, batch mode on Free',
  'BAS pack export and Xero sync',
  'Same occupation-aware deduction engine as Android — same accuracy, same tax logic',
];

/**
 * SoftwareApplication structured data for both platforms. Android is
 * reported as a real, available (beta-channel) app. iOS is reported
 * honestly as in development — no `offers`/availability claim that would
 * imply it can be installed today, because a false download claim in
 * structured data is the kind of thing that draws a manual action, and it
 * would undercut the SEO this section exists to build.
 */
function buildJsonLd(android: ReturnType<typeof getRelease>, ios: ReturnType<typeof getRelease>) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Snap Apps',
        operatingSystem: 'ANDROID',
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Tax and expense compliance',
        softwareVersion: android.version ?? undefined,
        datePublished: android.releaseDate ?? undefined,
        url: PAGE_URL,
        ...(android.availability === 'available' && android.url
          ? {
              downloadUrl: android.url,
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'AUD',
                availability: 'https://schema.org/InStock',
              },
            }
          : {}),
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Snap Apps',
        operatingSystem: 'IOS',
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Tax and expense compliance',
        url: PAGE_URL,
        releaseNotes: 'In active development — not yet available for download.',
        // Honest, non-purchasable state: PreOrder communicates "not currently
        // obtainable" without asserting a live download that does not exist.
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'AUD',
          availability: 'https://schema.org/PreOrder',
        },
      },
    ],
  };
}

// Async, and uncached, because the Android build is read from the API at
// render time rather than hardcoded — see `getAndroidRelease`.
export const dynamic = 'force-dynamic';

export default async function DownloadPage() {
  const android = await getAndroidRelease();
  const ios = getRelease('ios');
  const changelog = getChangelog();
  const androidReqs = getSystemRequirements('android');
  const iosReqs = getSystemRequirements('ios');
  const jsonLd = buildJsonLd(android, ios);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- static, locally-built JSON-LD, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* The same reading rail as every other marketing page. */}
      <PageSpine />

      {/*
        Rebuilt 2026-09-17, for the reason the pricing page was rebuilt the
        same week: this was the last page still built the old way — a bare
        `<main className="py-20">` of `Container` + `SectionTitle`, which is
        the eyebrow/title/lede stack `docs/DESIGN-HANDOFF.md` §12.1 lists under
        Avoid, with no gutter codes and not one line of motion. Arriving here
        from a home page that moves landed you in a static document.

        NOT pinned, and that is deliberate. The home page locks each section
        until its animation finishes, which is right for a page whose job is to
        be read in order. This page's job is to hand someone an APK and a
        checksum, and making them scroll-wrestle a lock to reach a SHA-256
        would be hostile. It gets the asset layer and the section language; it
        does not get `.screen` or `.pin-track`.

        Copy is untouched — every sentence, figure and step is the owner's,
        word for word. Only the structure and the motion changed.
      */}

      {/* 1 — the hero, through the one component every page opens with. */}
      <PageHero
        kicker="Download"
        title={
          <>
            Get Snap Apps on Android — and see what&apos;s coming to iPhone
          </>
        }
        lede="Android is a direct download today, with Google Play to follow. The iPhone app is in active development: this page shows exactly what it will do and how to hear the moment it's ready, rather than a link that doesn't work yet."
      />

      {/* 2 — gutter. The two platforms, as release records. */}
      <Section code="APK" className="sect-3d">
        <div className="pop-3d grid items-stretch gap-5 lg:grid-cols-2">
          {/* ── Android ─────────────────────────────────────────────────── */}
          <ReleaseCard
            platform="Android"
            title="Direct APK download"
            status={android.channel === 'beta' ? 'Beta' : 'Stable'}
            statusTone={android.channel === 'beta' ? 'warn' : 'good'}
            lede={
              <>
                Installed the same way any app was installed on Android before app stores existed —
                you&apos;ll see one extra permission prompt the first time, covered in the steps
                below. <strong className="text-[var(--color-ink)]">Coming to Google Play</strong>{' '}
                once the listing clears review.
              </>
            }
            action={
              <>
                <a
                  href={android.url ?? '#'}
                  className="flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[16px] font-semibold text-[var(--color-accent-ink)] transition-colors duration-150 hover:bg-[var(--color-accent-deep)]"
                >
                  Download for Android
                  {android.availability === 'available' && android.version
                    ? ` · v${android.version}`
                    : ''}
                </a>
                {android.availability === 'available' ? null : (
                  <p className="mt-2 text-center text-[12px] text-[var(--color-ink-faint)]">
                    No build published yet — this link will not install anything. See &quot;What&apos;s
                    new&quot; below.
                  </p>
                )}
              </>
            }
          >
            <ReleaseBlock title="This build">
              <SpecRow
                label="Version"
                value={`${android.version || '—'}${android.buildNumber ? ` (${android.buildNumber})` : ''}`}
              />
              <SpecRow label="Released" value={android.releaseDate || '—'} />
              <SpecRow label="File size" value={android.fileSizeLabel || '—'} />
              <SpecRow label="Requires" value={android.minOsVersion} mono={false} />
            </ReleaseBlock>

            <ReleaseBlock title="SHA-256 checksum">
              <CopyableChecksum sha256={android.sha256 ?? ''} />
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
                Step 3 below is how to compare it. Skipping it is fine — most people do.
              </p>
            </ReleaseBlock>

            {/* Mirrors the iOS card's footer so the two columns end flush.
                Both are `mt-auto`, so whichever side runs shorter takes up
                the slack instead of leaving a tall empty box beside a full
                one — which is what the old pair did. */}
            <div className="mt-auto grid gap-2 pt-6 text-[13px]">
              <a
                href="#android-top"
                className="flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] font-semibold text-[var(--color-ink)] transition-colors duration-150 hover:bg-[var(--color-surface-alt)]"
              >
                How to install it
              </a>
              <a
                href="#whats-new"
                className="text-center font-semibold text-[var(--color-accent)] hover:underline"
              >
                What changed in this build →
              </a>
            </div>
          </ReleaseCard>

          {/* ── iOS ─────────────────────────────────────────────────────── */}
          <ReleaseCard
            platform="iOS · iPhone"
            title="Snap Apps for iPhone"
            status="In development"
            statusTone="warn"
            lede={
              <>
                The iPhone build is being actively worked on. Apple doesn&apos;t allow a public .ipa
                download in any case — every iOS app reaches phones through Apple&apos;s own
                TestFlight channel first, then the App Store — and we&apos;ll open TestFlight here
                the moment there is a build worth putting in front of people.
              </>
            }
            action={
              <InertDownloadControl
                label="Not yet available on iOS"
                statusText="In development — no install link exists yet"
              />
            }
          >
            <ReleaseBlock title="What it will do">
              <ul className="space-y-2 text-[14px] text-[var(--color-ink)]">
                {IOS_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-[var(--color-accent)]" aria-hidden="true">
                      ✓
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </ReleaseBlock>

            <ReleaseBlock title="Planned">
              <SpecRow label="Minimum OS" value={ios.minOsVersion} mono={false} />
              <SpecRow label="Status" value="In development" mono={false} />
            </ReleaseBlock>

            {/* Pushed to the bottom so the two cards end on the same line
                however differently their middles run. */}
            <div className="mt-auto grid gap-2 pt-6 text-[13px]">
              <a
                href={IOS_NOTIFY_CONTACT}
                className="flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] font-semibold text-[var(--color-ink)] transition-colors duration-150 hover:bg-[var(--color-surface-alt)]"
              >
                Get notified when iOS is ready
              </a>
              <a
                href="#android-top"
                className="text-center font-semibold text-[var(--color-accent)] hover:underline"
              >
                Or get the Android build right now →
              </a>
            </div>
          </ReleaseCard>
        </div>
      </Section>

      {/* 3 — measure. */}
      <Section form="measure" className="sect-3d">
        <SectionHead
          kicker="Before you install"
          title="System requirements"
          lede="Stated here rather than discovered afterwards. The memory line is the one worth reading: it changes how the app works, not whether it works."
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <Reveal variant="deal" delay={0}>
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">Android</h3>
            <Tear className="mt-2" />
            <ul className="mt-3 space-y-2.5 text-[14px] text-[var(--color-ink-muted)]">
              {androidReqs.map((r) => (
                <li key={r.label}>
                  {r.label}
                  {r.note ? (
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--color-ink-faint)]">
                      {r.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal variant="deal" delay={1}>
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">iPhone (planned)</h3>
            <Tear className="mt-2" />
            <ul className="mt-3 space-y-2.5 text-[14px] text-[var(--color-ink-muted)]">
              {iosReqs.map((r) => (
                <li key={r.label}>
                  {r.label}
                  {r.note ? (
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--color-ink-faint)]">
                      {r.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* 4 — gutter. The install itself. */}
      <Section code="INSTALL" id="android-top" className="sect-3d">
        <SectionHead
          kicker="Installing on Android"
          title="Installing the APK, step by step"
          lede={
            'This app doesn\'t come from the Play Store yet, so Android calls it an app from an ' +
            '"unknown source" — that just means it isn\'t from a store, not that anything is ' +
            'wrong. Here\'s exactly what to expect.'
          }
        />
        <ol className="mt-10 space-y-6">
          {ANDROID_STEPS.map((step, i) => (
            <Reveal as="li" variant="deal" delay={i} key={step.title}>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[14px] font-bold tabular text-[var(--color-accent)]">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">{step.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                    {step.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* 5 — measure. */}
      <Section form="measure" id="whats-new" className="sect-3d">
        <SectionHead kicker="Changelog" title="What's new" />
        <div className="mt-10 space-y-8">
          {changelog.map((entry, i) => (
            <Reveal variant="deal" delay={i} key={entry.version}>
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-bold tabular text-[var(--color-ink)]">
                  v{entry.version}
                </span>
                <span className="tabular text-[13px] text-[var(--color-ink-faint)]">{entry.date}</span>
              </div>
              <Tear className="mt-2" />
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-[var(--color-ink-muted)]">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
