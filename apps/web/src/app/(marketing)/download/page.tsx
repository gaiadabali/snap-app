import type { Metadata } from 'next';

import { Badge, Card, Container, SectionTitle } from '@/design/primitives';
import { IOS_NOTIFY_CONTACT, getChangelog, getRelease, getSystemRequirements } from '@/lib/releases';

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

export default function DownloadPage() {
  const android = getRelease('android');
  const ios = getRelease('ios');
  const changelog = getChangelog();
  const androidReqs = getSystemRequirements('android');
  const iosReqs = getSystemRequirements('ios');
  const jsonLd = buildJsonLd(android, ios);

  return (
    <main className="py-20">
      {/* eslint-disable-next-line react/no-danger -- static, locally-built JSON-LD, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Container width="prose">
        <SectionTitle
          as="h1"
          eyebrow="Download"
          title="Get Snap Apps on Android — and see what's coming to iPhone"
          lede="Android is a direct download today, with Google Play to follow. The iPhone app is in active development: this page shows exactly what it will do and how to hear the moment it's ready, rather than a link that doesn't work yet."
        />
      </Container>

      <Container width="wide" className="mt-10">
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── Android ─────────────────────────────────────────────────── */}
          <Card className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                  Android
                </div>
                <h2 className="mt-1 text-[20px] font-bold text-[var(--color-ink)]">
                  Direct APK download
                </h2>
              </div>
              <Badge tone={android.channel === 'beta' ? 'warn' : 'good'}>
                {android.channel === 'beta' ? 'Beta' : 'Stable'}
              </Badge>
            </div>

            <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
              Installed the same way any app was installed on Android before app stores existed —
              you&apos;ll see one extra permission prompt the first time, covered in the steps
              below. <strong className="text-[var(--color-ink)]">Coming to Google Play</strong> once
              the listing clears review.
            </p>

            <a
              href={android.url ?? '#'}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[16px] font-semibold text-[var(--color-accent-ink)] transition-colors duration-150 hover:bg-[var(--color-accent-deep)]"
            >
              Download for Android · v{android.version}
            </a>
            <p className="mt-2 text-center text-[12px] text-[var(--color-ink-faint)]">
              Placeholder link — the first real build has not been published yet. See &quot;What&apos;s
              new&quot; below.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <div>
                <dt className="text-[var(--color-ink-faint)]">Version</dt>
                <dd className="tabular font-semibold text-[var(--color-ink)]">
                  {android.version} (build {android.buildNumber})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-faint)]">Released</dt>
                <dd className="tabular font-semibold text-[var(--color-ink)]">{android.releaseDate}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-faint)]">File size</dt>
                <dd className="tabular font-semibold text-[var(--color-ink)]">{android.fileSizeLabel}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-faint)]">Requires</dt>
                <dd className="font-semibold text-[var(--color-ink)]">{android.minOsVersion}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                SHA-256 checksum
              </div>
              <div className="mt-1">
                <CopyableChecksum sha256={android.sha256 ?? ''} />
              </div>
            </div>
          </Card>

          {/* ── iOS ─────────────────────────────────────────────────────── */}
          <Card className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                  iOS · iPhone
                </div>
                <h2 className="mt-1 text-[20px] font-bold text-[var(--color-ink)]">
                  Snap Apps for iPhone
                </h2>
              </div>
              <Badge tone="warn">In development</Badge>
            </div>

            <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
              The iPhone build is being actively worked on. Apple doesn&apos;t allow a public
              .ipa download in any case — every iOS app reaches phones through Apple&apos;s own
              TestFlight channel first, then the App Store — and we&apos;ll open TestFlight here
              the moment there is a build worth putting in front of people.
            </p>

            {/* A capture-state mockup, on brand: the scan line is reserved for
                capture/processing states (docs/WEB.md §4), and this is one. */}
            <div className="relative mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-4">
              <div className="scan-line relative mx-auto h-40 w-28 overflow-hidden rounded-[var(--radius-md)] border-2 border-[var(--color-rule-strong)] bg-[var(--color-surface)]">
                <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
                  <div className="h-1.5 w-10 rounded-full bg-[var(--color-rule-strong)]" />
                  <div className="h-1.5 w-14 rounded-full bg-[var(--color-rule-strong)]" />
                  <div className="h-1.5 w-8 rounded-full bg-[var(--color-rule-strong)]" />
                </div>
              </div>
              <p className="mt-3 text-center text-[12px] text-[var(--color-ink-faint)]">
                Same capture-and-extract pipeline as Android, in an iPhone-native shell.
              </p>
            </div>

            <ul className="mt-5 space-y-2 text-[14px] text-[var(--color-ink)]">
              {IOS_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-[var(--color-accent)]" aria-hidden="true">
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5">
              <InertDownloadControl
                label="Not yet available on iOS"
                statusText="In development — no install link exists yet"
              />
            </div>

            <div className="mt-3 grid gap-2 text-[13px]">
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

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <div>
                <dt className="text-[var(--color-ink-faint)]">Planned minimum OS</dt>
                <dd className="font-semibold text-[var(--color-ink)]">{ios.minOsVersion}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-faint)]">Status</dt>
                <dd className="font-semibold text-[var(--color-ink)]">In development</dd>
              </div>
            </dl>
          </Card>
        </div>
      </Container>

      {/* ── System requirements ─────────────────────────────────────────── */}
      <Container width="prose" className="mt-20">
        <SectionTitle eyebrow="Before you install" title="System requirements" />
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">Android</h3>
            <ul className="mt-2 space-y-1.5 text-[14px] text-[var(--color-ink-muted)]">
              {androidReqs.map((r) => (
                <li key={r.label}>{r.label}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">iPhone (planned)</h3>
            <ul className="mt-2 space-y-1.5 text-[14px] text-[var(--color-ink-muted)]">
              {iosReqs.map((r) => (
                <li key={r.label}>{r.label}</li>
              ))}
            </ul>
          </div>
        </div>
      </Container>

      {/* ── Install instructions ─────────────────────────────────────────── */}
      <Container width="prose" className="mt-20">
        <div id="android-top">
          <SectionTitle
            eyebrow="Installing on Android"
            title="Installing the APK, step by step"
            lede={
              'This app doesn\'t come from the Play Store yet, so Android calls it an app from an ' +
              '"unknown source" — that just means it isn\'t from a store, not that anything is ' +
              'wrong. Here\'s exactly what to expect.'
            }
          />
        </div>
        <ol className="mt-8 space-y-6">
          {ANDROID_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[14px] font-bold tabular text-[var(--color-accent)]">
                {i + 1}
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">{step.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Container>

      {/* ── What's new ───────────────────────────────────────────────────── */}
      <Container width="prose" className="mt-20">
        <SectionTitle eyebrow="Changelog" title="What's new" />
        <div className="mt-6 space-y-8">
          {changelog.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-bold tabular text-[var(--color-ink)]">
                  v{entry.version}
                </span>
                <span className="tabular text-[13px] text-[var(--color-ink-faint)]">{entry.date}</span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-[var(--color-ink-muted)]">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </main>
  );
}
