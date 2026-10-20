import type { Metadata } from 'next';

import { Btn, Chip, Icon, IconTile, Phone, Reveal, SectionHead, TextLink } from '@/design/site';
import { HomeScreen } from '@/design/site/app-ui';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';
import {
  IOS_NOTIFY_CONTACT,
  getAndroidRelease,
  getChangelog,
  getRelease,
  getSystemRequirements,
} from '@/lib/releases';

import { ReleaseBlock, ReleaseCard, SpecRow } from '../_components/release-card';
import { CopyableChecksum } from './copyable-checksum';
import './download.css';
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
    optional: false,
  },
  {
    title: 'Open the downloaded file',
    body: 'Find "Snap Apps" in your Downloads or notification shade and tap it. Android will show the permissions the app asks for — camera, for photographing receipts — then tap Install.',
    optional: false,
  },
  {
    title: 'Optional: check the file is exactly what we built',
    body: "If your file manager can show a file's SHA-256, compare it to the checksum on this page before installing. They should match exactly. If you don't know how to do this, it's fine to skip — most people do.",
    optional: true,
  },
];

/**
 * What the iPhone app is meant to do: the shipped personal release only. The
 * earlier list led with BAS export and Xero sync, which the app does not show
 * today, and "same accuracy" — an accuracy claim (design/site/README.md).
 */
const IOS_FEATURES = [
  'Photograph a receipt and have every line read and priced',
  'GST-free and taxable lines split, with tax invoice and ABN checks',
  'A true copy of the original kept for five years',
  'Spending, budgets, savings goals and household sharing',
];

/**
 * Changelog notes that describe business surfaces (BAS, Xero, practices) are
 * not displayed while those surfaces are off in the app — the site does not
 * sell what does not ship. `lib/releases.ts` is untouched; this only decides
 * what is shown.
 */
const BUSINESS_NOTE = /\b(BAS|Xero|Practice|Sole Trader)\b/;

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
  const changelog = getChangelog()
    .map((entry) => ({
      ...entry,
      notes: BUSINESS_SURFACES_ENABLED
        ? entry.notes
        : entry.notes.filter((note) => !BUSINESS_NOTE.test(note)),
    }))
    .filter((entry) => entry.notes.length > 0);
  const androidReqs = getSystemRequirements('android');
  const iosReqs = getSystemRequirements('ios');
  const jsonLd = buildJsonLd(android, ios);

  const liveUrl = android.availability === 'available' ? android.url : null;
  const facts = [
    android.version ? `Version ${android.version}` : null,
    android.fileSizeLabel,
    android.minOsVersion,
  ].filter((f): f is string => Boolean(f));

  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- static, locally-built JSON-LD, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative -mt-[84px] overflow-hidden pt-[124px] sm:pt-[140px]">
        <div className="dots" aria-hidden />
        <div className="shell relative">
          <div className="grid items-center gap-y-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-x-10">
            <div className="relative z-10 max-w-[40rem]">
              <div data-reveal="fade" suppressHydrationWarning>
                <Chip dot>
                  {liveUrl
                    ? `Android ${android.channel === 'beta' ? 'beta' : 'build'} available`
                    : 'Android build not published yet'}
                  {' · iPhone in development'}
                </Chip>
              </div>

              <h1
                className="hd-1 mt-7"
                data-reveal="blur"
                suppressHydrationWarning
                style={{ ['--d' as string]: 1 }}
              >
                Get Snap Apps on <span className="ink-grad">Android.</span>
              </h1>

              <p
                className="lede mt-6 max-w-[34rem]"
                data-reveal=""
                suppressHydrationWarning
                style={{ ['--d' as string]: 2 }}
              >
                Android is a direct download today; it is not on Google Play yet. The iPhone app is
                in active development: this page shows exactly what it will do and how to hear the
                moment it&apos;s ready, rather than a link that doesn&apos;t work yet.
              </p>

              <div
                className="mt-9 max-w-[26rem]"
                data-reveal=""
                suppressHydrationWarning
                style={{ ['--d' as string]: 3 }}
              >
                {liveUrl ? (
                  <>
                    <Btn href={liveUrl} size="lg" className="w-full" external>
                      <Icon name="download" size={20} />
                      Download APK
                    </Btn>
                    {facts.length > 0 ? (
                      <ul className="dl-meta mt-4">
                        {facts.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <InertDownloadControl
                    icon="download"
                    label="No Android build yet"
                    statusText="In development. No APK has been published, so there is nothing to install."
                  />
                )}
                <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <TextLink href="#install">How to install it</TextLink>
                  <TextLink href="#web">Use it in your browser</TextLink>
                </div>
              </div>
            </div>

            <div className="relative mx-auto flex w-full max-w-[460px] justify-center py-4 lg:py-8">
              <div
                className="horizon"
                aria-hidden
                style={{ width: '120%', height: '70%', left: '-10%', top: '18%' }}
              />
              <div className="tilt relative" data-reveal="scale" suppressHydrationWarning>
                <Phone className="relative [--pw:272] sm:[--pw:320]">
                  <HomeScreen />
                </Phone>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Android: the build, its checksum, the install ──────────────── */}
      <section id="android" className="section">
        <div className="shell">
          <Reveal className="card grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="p-7 sm:p-10 lg:border-r lg:border-[var(--s-edge)]">
              <div className="flex items-center justify-between gap-3">
                <span className="kicker">Android · direct APK</span>
                <span
                  className={
                    android.channel === 'beta'
                      ? 'rounded-full bg-[var(--s-amber-soft)] px-3 py-1 text-[0.75rem] font-semibold text-[var(--s-amber)]'
                      : 'rounded-full bg-[var(--s-green-soft)] px-3 py-1 text-[0.75rem] font-semibold text-[var(--s-green)]'
                  }
                >
                  {android.channel === 'beta' ? 'Beta' : 'Stable'}
                </span>
              </div>
              <h2 className="hd-2 mt-4">This build</h2>
              <p className="body mt-3 max-w-[36ch]">
                Installed the same way any app was installed on Android before app stores existed.
                You&apos;ll see one extra permission prompt the first time, because it is{' '}
                <strong className="font-semibold text-[var(--s-ink)]">not on Google Play yet</strong>.
              </p>

              <div className="mt-8">
                <SpecRow
                  label="Version"
                  value={`${android.version || '—'}${android.buildNumber ? ` (${android.buildNumber})` : ''}`}
                />
                <SpecRow label="Released" value={android.releaseDate || '—'} />
                <SpecRow label="File size" value={android.fileSizeLabel || '—'} />
                <SpecRow label="Requires" value={android.minOsVersion} mono={false} />
              </div>

              <div className="mt-8">
                <h3 className="text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-[var(--s-ink-4)]">
                  SHA-256 checksum
                </h3>
                <div className="mt-3">
                  <CopyableChecksum sha256={android.sha256 ?? ''} />
                </div>
                <p className="small mt-3">
                  The optional last install step is how to compare it. Skipping it is fine — most
                  people do.
                </p>
              </div>
            </div>

            <div id="install" className="p-7 sm:p-10">
              <h2 className="hd-3">Installing the APK, step by step</h2>
              <p className="body mt-3 max-w-[44ch]">
                This app doesn&apos;t come from the Play Store yet, so Android calls it an app from
                an &quot;unknown source&quot; — that just means it isn&apos;t from a store, not that
                anything is wrong. Here&apos;s exactly what to expect.
              </p>
              <ol className="dl-steps mt-8">
                {ANDROID_STEPS.map((step, i) => (
                  <li
                    key={step.title}
                    className={`dl-step${step.optional ? ' dl-step-optional' : ''}`}
                  >
                    <span className="dl-step-n" aria-hidden>
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="hd-4">{step.title}</h3>
                      <p className="small mt-1.5">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-8">
                <TextLink href="#whats-new">What changed in this build</TextLink>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── iPhone and the browser ──────────────────────────────────────── */}
      <section className="band-mist">
        <div className="shell py-16 sm:py-24">
          <SectionHead
            align="left"
            title="Not on Android? Two other ways in."
            lede="The iPhone app is on its way. The web app works in any browser today."
            className="mb-12"
          />
          <div className="grid gap-5 lg:grid-cols-2">
            {/* iPhone — full weight, honest, non-actionable */}
            <Reveal className="h-full">
              <ReleaseCard
                platform="iPhone"
                title="Snap Apps for iPhone"
                status="In development"
                statusTone="warn"
                lede={
                  <>
                    The iPhone build is being actively worked on. Apple doesn&apos;t allow a public
                    .ipa download in any case — every iOS app reaches phones through Apple&apos;s own
                    TestFlight channel first, then the App Store — and we&apos;ll open TestFlight
                    here the moment there is a build worth putting in front of people.
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
                  <ul className="dl-list space-y-2.5 text-[0.9375rem] text-[var(--s-ink-2)]">
                    {IOS_FEATURES.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </ReleaseBlock>

                <ReleaseBlock title="Planned">
                  <SpecRow label="Minimum OS" value={ios.minOsVersion} mono={false} />
                  <SpecRow label="Status" value="In development" mono={false} />
                </ReleaseBlock>

                <div className="mt-auto pt-7">
                  <Btn href={IOS_NOTIFY_CONTACT} variant="secondary" className="w-full">
                    Get notified when iOS is ready
                  </Btn>
                </div>
              </ReleaseCard>
            </Reveal>

            {/* The web app */}
            <Reveal delay={1} className="h-full">
              <div
                id="web"
                className="night grain flex h-full flex-col rounded-[var(--s-radius)] p-7 sm:p-9"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="kicker">Web app</span>
                  <span className="rounded-full bg-[var(--s-green-soft)] px-3 py-1 text-[0.75rem] font-semibold text-[var(--s-green)]">
                    Available now
                  </span>
                </div>
                <h2 className="hd-3 mt-4">Use it in your browser today</h2>
                <p className="body mt-3">
                  Any phone, tablet or computer. Upload a docket, review the reading, and see your
                  spending, with nothing to install.
                </p>
                <div className="mt-7 flex items-center gap-4">
                  <IconTile name="globe" tone="white" size={52} />
                  <p className="small">
                    Same account as the app, so what you scan on the web is there when you pick up
                    your phone.
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-9">
                  <Btn href="/register" variant="light" arrow>
                    Start free on the web
                  </Btn>
                  <Btn href="/sign-in" variant="glass">
                    Sign in
                  </Btn>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Requirements and changelog ──────────────────────────────────── */}
      <section className="section">
        <div className="shell">
          <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <Reveal>
                <h2 className="hd-2">Before you install</h2>
                <p className="lede mt-5 max-w-[36ch]">
                  Stated here rather than discovered afterwards. The memory line is the one worth
                  reading: it changes how the app works, not whether it works.
                </p>
              </Reveal>
              <div className="mt-10 grid gap-8">
                <Reveal>
                  <h3 className="hd-4">Android</h3>
                  <RequirementList items={androidReqs} />
                </Reveal>
                <Reveal delay={1}>
                  <h3 className="hd-4">iPhone (planned)</h3>
                  <RequirementList items={iosReqs} />
                </Reveal>
              </div>
            </div>

            <div id="whats-new">
              <Reveal>
                <h2 className="hd-2">What&apos;s new</h2>
              </Reveal>
              <div className="mt-10 space-y-10">
                {changelog.map((entry, i) => (
                  <Reveal delay={i} key={entry.version}>
                    <div className="dl-log">
                      <div className="flex items-baseline gap-3">
                        <span className="text-[1.125rem] font-[650] tabular-nums tracking-[-0.02em]">
                          v{entry.version}
                        </span>
                        <span className="small tabular-nums">{entry.date}</span>
                      </div>
                      <ul className="dl-list body mt-4 space-y-2">
                        {entry.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function RequirementList({ items }: { items: ReturnType<typeof getSystemRequirements> }) {
  return (
    <ul className="dl-list mt-4 space-y-3 text-[0.9375rem] text-[var(--s-ink-2)]">
      {items.map((r) => (
        <li key={r.label}>
          {r.label}
          {r.note ? <span className="small mt-0.5 block">{r.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
