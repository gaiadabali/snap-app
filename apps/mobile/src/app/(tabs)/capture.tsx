import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { readOnDevice, recordReading, type DeviceRead } from '@/lib/device-read';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CapturePageUpload } from '@/api';
import { ScanLine } from '@/components/ScanLine';
import { Body, Button, Card, Figure, Label, Screen, Small } from '@/components/ui';
import { radius, space, usePalette } from '@/theme';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

type Phase = 'framing' | 'hashing' | 'uploading' | 'extracting';

/**
 * One photographed page, before it has been registered with the server.
 *
 * Hashed at capture time so the tray never has to re-read the file to find
 * out what it is holding — `sha256` and `byteSize` are exactly what
 * `createCapture` needs for this page's `CapturePageInput`.
 */
interface TrayPage {
  uri: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  /**
   * The bytes themselves — web only.
   *
   * On a device, `uri` is a real file path and the bytes are re-read lazily at
   * upload time so twenty photographs are never all in memory at once. A
   * browser has no such path: a picked file exists only as a `blob:` URL that
   * `expo-file-system` cannot open, so the web path has to hold what it read.
   */
  bytes?: ArrayBuffer;
}

/** Where one page's upload stands, for the progress list during `uploading`. */
type PageStatus = 'pending' | 'uploading' | 'done' | 'skipped' | 'failed';

/**
 * A capture that has been registered with the server but is not fully
 * uploaded yet.
 *
 * Kept in state — not just a local variable — for exactly one reason: if a
 * page fails, this is what "Retry" resumes. Nothing here ever triggers a
 * second `createCapture` call, because that would register a second document
 * for the same paper.
 */
interface PendingCapture {
  captureId: string;
  uploads: CapturePageUpload[];
  pages: TrayPage[];
}

/** At most this many pages, matching the limit `CreateCaptureRequest.pages` accepts. */
const MAX_PAGES = 20;

function pageStatusLabel(status: PageStatus | undefined): string {
  switch (status) {
    case 'done':
      return 'Uploaded';
    case 'uploading':
      return 'Uploading…';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Already had it';
    default:
      return 'Waiting';
  }
}

/**
 * Uploads one page, absorbing a transient network blip before giving up.
 *
 * Pages are independent blobs at independent URLs, so one failing must never
 * cost the others. Three attempts with a short, growing pause covers the
 * ordinary flaky-signal case — a truck stop, one bar of reception — without
 * turning a real failure into a spinner that never stops.
 */
async function uploadPageWithRetry(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await api().uploadOriginal(uploadUrl, bytes, mimeType);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

/**
 * Capture.
 *
 * The on-device work here is a PRE-FLIGHT CHECK only — is this a document, is
 * it legible — never extraction. Extraction is a versioned server-side function
 * of the stored original, so it can be re-run when the model improves. If the
 * device extracted, historical records would be frozen at whatever the app
 * shipped with and no backfill would ever be possible.
 */
export default function CaptureScreen() {
  const p = usePalette();
  const { workspace, workspaces, active } = useWorkspace();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('framing');
  const [error, setError] = useState<string | null>(null);
  /**
   * Pages held before processing.
   *
   * Empty for the common single-page case: the shutter captures and processes
   * in one action, because adding a confirmation step to the thing people do
   * twenty times a day to save the rare two-page invoice is the wrong trade.
   * Tapping "Add page" switches into collecting mode.
   */
  const [pages, setPages] = useState<TrayPage[]>([]);
  /** Set once `createCapture` has returned and cleared only when every page has uploaded. */
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [pageStatus, setPageStatus] = useState<Record<number, PageStatus>>({});
  /**
   * The torch, for a docket on a restaurant table or in a ute footwell.
   *
   * Off on every mount rather than remembered: a phone that silently turns its
   * light on when the scan tab opens is alarming in a quiet room, and the cost
   * of the alternative is one tap.
   */
  /**
   * What the phone itself read, held from the shutter until the capture exists.
   *
   * Computed from the FIRST page only. A multi-page document's header — who,
   * when, how much — is on page one, and recognising page five to find a
   * supplier name costs time nobody gets back. The server reads every page.
   */
  const deviceReadRef = useRef<DeviceRead | null>(null);
  const [torch, setTorch] = useState(false);
  /**
   * Whether the overlay cards are showing.
   *
   * They sit on top of the thing being photographed, so they have to be
   * dismissible — a tap anywhere on the viewfinder hides them, and they come
   * back on the next tap or whenever there is something new to say. An error
   * always reappears, because a capture that failed silently is worse than one
   * that interrupts.
   */
  const [chrome, setChrome] = useState(true);
  const camera = useRef<CameraView>(null);

  /** Photographs one page and returns its uri, bytes and hash. */
  /**
   * Capture, on a platform with no camera.
   *
   * `expo-camera` has no working `CameraView` on web, so the web build showed a
   * black placeholder and the shutter failed every single time with "the camera
   * returned no image" — which meant the capture flow, the thing this product
   * is, could not be exercised in a browser at all, by a person or by a test.
   *
   * A file picker is the honest substitute: it produces the same bytes a camera
   * would, which is all the pipeline downstream actually cares about. It also
   * accepts a PDF, which is how a supplier invoice usually arrives anyway.
   *
   * `globalThis.File` rather than `File`, because `expo-file-system` exports a
   * class of that name and it is already imported here.
   */
  async function pickFileOnWeb(): Promise<{
    uri: string;
    bytes: ArrayBuffer;
    sha256: string;
    mimeType: string;
  }> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    const chosen = await new Promise<globalThis.File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      // Cancelling the dialog is an ordinary thing to do, not an error.
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!chosen) throw new Error('No file was chosen.');

    const bytes = await chosen.arrayBuffer();
    // Same Uint8Array wrap as the native path. Web tolerates a bare
    // ArrayBuffer, but one spelling for both keeps the next person from
    // copying the tolerant one onto a platform that is not.
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    return {
      uri: URL.createObjectURL(chosen),
      bytes,
      sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      mimeType: chosen.type || 'application/octet-stream',
    };
  }

  async function shoot() {
    if (Platform.OS === 'web') return pickFileOnWeb();

    const photo = await camera.current?.takePictureAsync({
      quality: 0.9,
      // The ATO accepts an electronic copy only if it is a true and clear
      // reproduction, so no downscaling happens here. Normalisation for the
      // model is a separate, server-side derivative.
      skipProcessing: false,
    });
    if (!photo?.uri) throw new Error('The camera returned no image.');
    // The device read, started before the digest and the upload so the
    // preview is ready by the time the capture exists. It cannot throw — see
    // `readOnDevice` — so there is no try/catch here and no failure path into
    // the capture.
    if (pages.length === 0) {
      deviceReadRef.current = await readOnDevice(photo.uri);
    }

    const bytes = await new File(photo.uri).arrayBuffer();
    // Native only, so the bytes are not retained here: `uri` is a real path and
    // the upload re-reads it when it needs it.
    //
    // A Uint8Array, NOT the bare ArrayBuffer. `Crypto.digest` is typed to take
    // a BufferSource, which includes ArrayBuffer, but Expo's native bridge
    // marshals only TYPED arrays into a Kotlin ByteArray. Handing it the buffer
    // failed on the handset with
    //
    //     [digest] Cannot convert '[object ArrayBuffer]' to a Kotlin type.
    //              no ArrayBuffer attached
    //
    // which is every capture on Android, not an edge case. TypeScript accepted
    // it because the declared type is wider than what the native side takes.
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    const sha256 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { uri: photo.uri, bytes, sha256, mimeType: 'image/jpeg' };
  }

  /** Adds a page to the tray without processing anything yet. */
  async function onAddPage() {
    setError(null);
    // The shutter adds one more page on top of whatever is already held, so
    // the cap is checked here rather than after the fact — better to say so
    // while the tray still fits under it than to have `createCapture` reject
    // the document after every page has already been photographed.
    if (pages.length + 1 >= MAX_PAGES) {
      setError(`A document can hold at most ${MAX_PAGES} pages. Finish this one with the shutter.`);
      return;
    }
    try {
      setPhase('hashing');
      const shot = await shoot();
      setPages((prev) => [
        ...prev,
        {
          uri: shot.uri,
          sha256: shot.sha256,
          // What was actually picked, not an assumption. A PDF uploaded as
          // `image/jpeg` is refused by the server's content-type parser.
          mimeType: shot.mimeType,
          byteSize: shot.bytes.byteLength,
          // Web only — see TrayPage.bytes for why a browser cannot re-read.
          bytes: Platform.OS === 'web' ? shot.bytes : undefined,
        },
      ]);
      setPhase('framing');
    } catch (err) {
      setPhase('framing');
      setError(err instanceof Error ? err.message : 'Could not add that page.');
    }
  }

  /**
   * Uploads every page of a registered capture, then waits for extraction.
   *
   * `resume: true` is what "Retry" sends: pages already marked `done` (from
   * an earlier pass through this same function) are left alone, so a retry
   * finishes the document instead of re-uploading pages that already landed.
   */
  async function uploadAndExtract(pc: PendingCapture, options: { resume: boolean } = { resume: false }) {
    setPhase('uploading');
    setError(null);
    setPending(pc);

    const statuses: Record<number, PageStatus> = options.resume ? { ...pageStatus } : {};
    const paint = () => setPageStatus({ ...statuses });
    paint();

    for (const upload of pc.uploads) {
      if (upload.alreadyStored) {
        // These exact bytes are already held by the server — re-uploading
        // would only spend the user's data for nothing.
        statuses[upload.pageNumber] = 'skipped';
        paint();
        continue;
      }
      if (statuses[upload.pageNumber] === 'done') continue; // landed on an earlier attempt

      statuses[upload.pageNumber] = 'uploading';
      paint();
      const page = pc.pages[upload.pageNumber - 1];
      if (!page) {
        // Cannot happen in practice — `uploads` and `pages` come from the
        // same `createCapture` call, in the same page order — but a missing
        // page must fail loudly rather than upload the wrong bytes to a slot.
        statuses[upload.pageNumber] = 'failed';
        paint();
        continue;
      }
      try {
        // Web carries its own bytes; a device re-reads them from the path it
        // stored, so a long document never sits in memory all at once.
        const bytes = page.bytes ?? (await new File(page.uri).arrayBuffer());
        await uploadPageWithRetry(upload.uploadUrl, bytes, page.mimeType);
        statuses[upload.pageNumber] = 'done';
      } catch {
        // This one page failed; the loop carries on to the rest rather than
        // abandoning pages that have nothing wrong with them.
        statuses[upload.pageNumber] = 'failed';
      }
      paint();
    }

    const failed = pc.uploads.filter((u) => statuses[u.pageNumber] === 'failed');
    if (failed.length > 0) {
      // A failed page must not orphan the capture: `pending` stays set so
      // Retry resumes exactly what is missing, never a second `createCapture`
      // for the same document.
      setPhase('framing');
      setError(
        failed.length === 1
          ? `Page ${failed[0]!.pageNumber} did not upload. The rest is safe — tap Retry to finish.`
          : `${failed.length} pages did not upload. The rest is safe — tap Retry to finish.`,
      );
      return;
    }

    // OD-7, fire-and-forget. Sent AFTER the pages are uploaded so the capture
    // certainly exists server-side, and not awaited: the reading is advisory
    // and a slow or failed upload of it must not delay the person's document
    // by a single millisecond.
    const read = deviceReadRef.current;
    if (read) recordReading(pc.captureId, read);

    // GO NOW, if the phone read anything.
    //
    // This used to wait on `awaitExtraction` before navigating, which made the
    // preview pointless: the numbers sat in a variable until the server
    // produced its own, and the person saw a spinner. On the handset the
    // extraction timed out and they saw NOTHING — with this they see the total
    // the phone already read.
    //
    // OD-8: "navigate to the review screen in provisional mode WHILE upload
    // and extraction proceed". The review screen does the waiting from here.
    const localPages = JSON.stringify(pc.pages.map((page) => page.uri));
    if (read) {
      setPhase('framing');
      setPending(null);
      setPageStatus({});
      router.push({
        pathname: '/document/[id]',
        params: {
          // No document exists yet — that is the point. The review screen
          // awaits extraction itself and swaps this for the real record.
          id: 'pending',
          captureId: pc.captureId,
          localPages,
          preview: JSON.stringify(read.preview),
        },
      });
      deviceReadRef.current = null;
      return;
    }

    // NO DEVICE READ — Expo Go, no Play services, a PDF, a throw inside ML
    // Kit. §OD-8 requires this path to be byte-for-byte what it was before the
    // preview existed, so it is left exactly as it was.
    setPhase('extracting');
    try {
      const doc = await api().awaitExtraction(pc.captureId, pc.pages[0]?.uri, workspace);
      setPhase('framing');
      setPending(null);
      setPageStatus({});
      router.push({
        pathname: '/document/[id]',
        params: {
          id: doc.id,
          // The pages just captured, still on this device, so the review
          // screen can page through them immediately. A document reopened
          // later falls back to its single stored image — the server does
          // not yet hand back a full page list over the wire.
          localPages,
        },
      });
    } catch (err) {
      // Every page is already stored either way — only the wait for a
      // reading failed. Keep `pending` so Retry does not re-upload anything.
      setPhase('framing');
      setError(err instanceof Error ? err.message : 'Could not finish reading this capture.');
    }
  }

  function discardPending() {
    setPending(null);
    setPageStatus({});
    setError(null);
  }

  async function onShutter() {
    setError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Haptics are unavailable on web and some devices; never block capture.
    }

    try {
      // ── 1. Take the final page (or the only one) ──
      setPhase('hashing');
      const shot = await shoot();
      const allPages: TrayPage[] = [
        ...pages,
        {
          uri: shot.uri,
          sha256: shot.sha256,
          // What was actually picked, not an assumption. A PDF uploaded as
          // `image/jpeg` is refused by the server's content-type parser.
          mimeType: shot.mimeType,
          byteSize: shot.bytes.byteLength,
          // Web only — see TrayPage.bytes for why a browser cannot re-read.
          bytes: Platform.OS === 'web' ? shot.bytes : undefined,
        },
      ];

      // ── 2. Register the capture; the server dedupes before any upload ──
      const capture = await api().createCapture({
        // Advisory only: the server recomputes the authoritative hash of
        // every page from the bytes it actually receives. A client-supplied
        // hash must never be trusted for what is a legal record.
        pages: allPages.map((page) => ({
          sha256: page.sha256,
          mimeType: page.mimeType,
          byteSize: page.byteSize,
        })),
        capturedAt: new Date().toISOString(),
        // No on-device legibility measurement exists. Sending a number here
        // would assert a confidence nobody checked — worse than sending
        // nothing, which is the same principle the whole extraction pipeline
        // is built on.
      });

      if (capture.duplicate) {
        // Silently returning home was worse than useless: the user cannot
        // tell whether the app worked. Photographing the same docket twice is
        // normal — you are not sure the first one took — and the honest
        // answer is that they already have it.
        setPhase('framing');
        setPages([]);
        Alert.alert(
          'You already have this one',
          'These exact bytes were captured before, so it has not been added twice. One receipt, one claim.',
          [
            { text: 'Keep scanning', style: 'cancel' },
            { text: 'See receipts', onPress: () => router.push('/receipts') },
          ],
        );
        return;
      }

      // ── 3. Upload every page straight to object storage, not through the
      //        API, then wait for extraction ──
      setPages([]);
      await uploadAndExtract({ captureId: capture.captureId, uploads: capture.uploads, pages: allPages });
    } catch (err) {
      setPhase('framing');
      setError(err instanceof Error ? err.message : 'Capture failed. Please try again.');
    }
  }

  // ── Permission states ──
  if (!permission) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={p.accent} />
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
          <Figure size="h1">Camera access</Figure>
          <Body muted>
            Snap Apps needs the camera to photograph receipts and tax invoices. The original image is
            kept unmodified — the ATO only accepts an electronic copy of a receipt if it is a true
            and clear reproduction.
          </Body>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        </View>
      </Screen>
    );
  }

  const busy = phase !== 'framing';
  const phaseCopy: Record<Exclude<Phase, 'framing'>, { title: string; detail: string }> = {
    hashing: {
      title: 'Fingerprinting…',
      detail: 'SHA-256 of the original bytes, so a re-scan is never double-counted',
    },
    uploading: {
      title: 'Uploading…',
      detail: 'Each page goes up as its own file, stored unmodified as the legal record',
    },
    extracting: {
      title: 'Reading the receipt…',
      detail: 'Checking ABN, GST arithmetic and the ATO tax-invoice elements',
    },
  };

  return (
    <Screen style={{ backgroundColor: '#000' }}>
      {/* `expo-camera` has no meaningful web implementation of CameraView, so the
          web build shows a framing placeholder and the device shows the real
          viewfinder. */}
      {Platform.OS === 'web' ? (
        <View style={{ flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#888', textAlign: 'center', paddingHorizontal: space.xl }}>
            No camera in a browser. The shutter opens a file picker — choose a
            photo or a PDF of the document.
          </Text>
        </View>
      ) : (
        <Pressable
          style={{ flex: 1 }}
          // The viewfinder itself is the dismiss target. No accessibility role:
          // this is a convenience over the whole frame, and every action it
          // shortcuts is also reachable from a labelled control.
          accessible={false}
          onPress={() => setChrome((on) => !on)}
        >
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" enableTorch={torch} />
        </Pressable>
      )}

      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: insets.top + 108,
          left: space.xl,
          right: space.xl,
          bottom: 200,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.85)',
          borderRadius: radius.lg,
          borderStyle: 'dashed',
          overflow: 'hidden',
        }}
      >
        {/* The signature sweep, and only here: extraction is the one moment
            this app reads a document, and the cyan line says so. */}
        <ScanLine active={phase === 'extracting'} />
      </View>

      <View
        style={{
          position: 'absolute',
          top: insets.top + space.lg,
          left: space.lg,
          right: space.lg,
          // Hidden rather than unmounted, so dismissing does not reset the
          // workspace switch's own open/closed state.
          display: chrome ? 'flex' : 'none',
        }}
      >
        {/* ONE LINE, because this sits on top of the thing being photographed.
            It used to be a five-line card — "Filing to", a workspace switch, a
            "Pre-flight check" heading, a verdict, and an explanatory sentence —
            covering the top third of the viewfinder, so framing a docket meant
            aiming around the instructions.

            The verdict was also NOT TRUE. `Document detected · sharp · all four
            corners in frame` was a hardcoded string: nothing measured document
            detection, sharpness or corners, and it read the same pointed at a
            wall. D16 is that nothing may be asserted that cannot be pointed at,
            and a confident green light over a blurred photo is the exact
            failure the pre-flight idea exists to prevent. It is removed rather
            than restyled — when the check is really implemented it can come
            back, driven by a measurement.

            What stays is the one thing that is both true and decided BEFORE the
            shutter: which life this receipt is filed against. Discovering a
            personal grocery run in the BAS three months later is the mistake
            that prevents. */}
        <Card style={{ paddingVertical: space.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.md,
            }}
          >
            <Label>Filing to</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              {/* A NAME when there is nothing to switch between.
                  `WorkspaceSwitch` returns null on one workspace, which is
                  right for a switch and left "Filing to" as a label with
                  nothing after it — the owner saw exactly that on the handset.
                  Which life a receipt is filed against is worth stating even
                  when there is only one answer; it is the decision this panel
                  exists to make before the shutter. */}
              {workspaces.length > 1 ? <WorkspaceSwitch /> : <Body>{active.name}</Body>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide this panel"
                hitSlop={12}
                onPress={() => setChrome(false)}
              >
                <Text style={{ color: p.inkFaint, fontSize: 18, lineHeight: 18 }}>×</Text>
              </Pressable>
            </View>
          </View>
        </Card>
      </View>

      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + space.xl,
          left: 0,
          right: 0,
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
        }}
      >
        {error ? (
          <Card tone="risk" style={{ width: '100%' }}>
            <View style={{ gap: space.xs }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}
              >
                <Label style={{ color: p.risk, flex: 1 }}>Capture failed</Label>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss this error"
                  hitSlop={12}
                  onPress={() => setError(null)}
                >
                  <Text style={{ color: p.risk, fontSize: 18, lineHeight: 18 }}>×</Text>
                </Pressable>
              </View>
              <Body>{error}</Body>
            </View>
          </Card>
        ) : null}

        {pending ? (
          <Card style={{ width: '100%' }}>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                {phase !== 'framing' ? <ActivityIndicator color={p.accent} /> : null}
                <Body strong>
                  {phase === 'extracting'
                    ? phaseCopy.extracting.title
                    : phase === 'uploading'
                      ? phaseCopy.uploading.title
                      : 'Upload paused'}
                </Body>
              </View>

              {/* One row per page, so "some of this document did not save" is
                  never a mystery — the person can see exactly which page. */}
              <View style={{ gap: 4 }}>
                {pending.uploads.map((u) => (
                  <View
                    key={u.pageNumber}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                  >
                    <Small>Page {u.pageNumber}</Small>
                    <Small
                      style={
                        pageStatus[u.pageNumber] === 'failed' ? { color: p.risk, fontWeight: '700' } : undefined
                      }
                    >
                      {pageStatusLabel(pageStatus[u.pageNumber])}
                    </Small>
                  </View>
                ))}
              </View>

              {phase === 'framing' ? (
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                  <Button label="Discard" tone="outline" style={{ flex: 1 }} onPress={discardPending} />
                  <Button
                    label="Retry"
                    style={{ flex: 1 }}
                    onPress={() => void uploadAndExtract(pending, { resume: true })}
                  />
                </View>
              ) : null}
            </View>
          </Card>
        ) : busy ? (
          <Card style={{ minWidth: 280 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <ActivityIndicator color={p.accent} />
              <View style={{ flex: 1 }}>
                <Body strong>{phaseCopy[phase as Exclude<Phase, 'framing'>].title}</Body>
                <Small>{phaseCopy[phase as Exclude<Phase, 'framing'>].detail}</Small>
              </View>
            </View>
          </Card>
        ) : (
          <View style={{ alignItems: 'center', gap: space.md, width: '100%' }}>
            {/* Pages already held. Visible because a two-page invoice whose
                second page you cannot see is a two-page invoice you will
                photograph twice. */}
            {pages.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}
              >
                {pages.map((page, i) => (
                  <View key={page.uri} style={{ alignItems: 'center', gap: 4 }}>
                    <Image
                      source={{ uri: page.uri }}
                      style={{
                        width: 46,
                        height: 62,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: 'rgba(255,255,255,0.85)',
                      }}
                      accessibilityLabel={`Page ${i + 1}`}
                    />
                    <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                      {i + 1}
                    </Text>
                  </View>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Discard the collected pages"
                  onPress={() => setPages([])}
                  style={{ justifyContent: 'center', paddingHorizontal: space.sm }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Clear</Text>
                </Pressable>
              </ScrollView>
            ) : null}

            {/* THREE CONTROLS, SYMMETRIC.
                Add page and Torch are the same 56pt circle either side of the
                shutter, so the row balances on the shutter instead of being
                padded out by an empty spacer. Everything sits in one band at
                the bottom, which keeps the viewfinder — the part that actually
                needs to be seen — clear. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                maxWidth: 320,
              }}
            >
              <SideControl
                label="Add page"
                glyph="+"
                accessibilityLabel="Add another page to this document"
                onPress={() => void onAddPage()}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  pages.length > 0
                    ? `Capture the last page and finish, ${pages.length} already added`
                    : 'Capture receipt'
                }
                onPress={() => void onShutter()}
                style={({ pressed }) => ({
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  backgroundColor: pressed ? p.accentSoft : '#FFFFFF',
                  borderWidth: 5,
                  borderColor: p.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                {pages.length > 0 ? (
                  <Text style={{ color: p.accent, fontWeight: '800', fontSize: 13 }}>
                    {pages.length + 1}
                  </Text>
                ) : null}
              </Pressable>

              <SideControl
                label={torch ? 'Torch on' : 'Torch'}
                glyph="⚡"
                on={torch}
                accessibilityLabel={torch ? 'Turn the torch off' : 'Turn the torch on'}
                onPress={() => setTorch((t) => !t)}
              />
            </View>

            {pages.length > 0 ? (
              <Small style={{ color: '#FFFFFF', textAlign: 'center' }}>
                {pages.length} page{pages.length === 1 ? '' : 's'} held — the shutter takes the
                last one and files them as one document.
              </Small>
            ) : null}
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * One of the two controls flanking the shutter.
 *
 * Shared so they cannot drift apart: the row only reads as balanced while both
 * sides are the same size, and two separately-styled Pressables is how that
 * stops being true.
 */
function SideControl({
  label,
  glyph,
  onPress,
  accessibilityLabel,
  on = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  accessibilityLabel: string;
  on?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ alignItems: 'center', gap: 6, width: 76 }}
    >
      {({ pressed }) => (
        <>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
              backgroundColor: on
                ? 'rgba(255,255,255,0.9)'
                : pressed
                  ? 'rgba(255,255,255,0.25)'
                  : 'rgba(0,0,0,0.25)',
            }}
          >
            <Text style={{ color: on ? '#14181D' : '#FFFFFF', fontSize: 22 }}>{glyph}</Text>
          </View>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
