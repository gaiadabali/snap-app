# @snap/mobile

Expo React Native client for Snap Apps. **Demo-ready.**

Thin by design: capture, review, read. It depends on `@snap/api-contract` (types only) and nothing
else from this workspace — enforced by `test/boundaries.test.ts` at the repo root.

---

## Running it for the demo

```bash
pnpm install                       # from the repo root

# Phones (recommended for the demo — the camera is real)
pnpm --filter @snap/mobile start   # scan the QR with Expo Go
pnpm --filter @snap/mobile ios
pnpm --filter @snap/mobile android

# Browser (easiest for a projector or a screen-share)
pnpm --filter @snap/mobile web
```

Nothing else needs to be running. **There is no server dependency** — the app talks to `MockApi`,
so it works on a plane, in a boardroom with bad wifi, or on a laptop with nothing else installed.

### If you want a self-contained build to hand over

```bash
pnpm --filter @snap/mobile export:web     # -> .expo-web/
cd apps/mobile/.expo-web && python -m http.server 8080
```

That directory is a static site: copy it to any host and the demo runs.

---

## The demo script

Three taps tell the whole story.

1. **Position** opens on the lead: **$177.15 of GST credits at risk, across 6 documents.** That
   figure is the product's argument — money the client loses unless a supplier is chased for a
   compliant tax invoice. No competitor doing OCR-to-CSV can compute it, because none of them model
   invoice validity.
2. **Tap the red card** → the six offending receipts, filtered.
3. **Open “Beaurepaires Orange — $1,848.00.”** The GST is $168.00 and it is at risk for a reason
   most software misses: at $1,000 or more the ATO also requires the **buyer's** ABN on the invoice.
   The screen says so in plain English and tells you the fix.
4. **Open a coffee-van docket** and tap **Add supplier ABN**. Type a valid ABN and the credit is
   rescued — the headline figure on Position drops when you go back. That is the loop the whole
   product exists to close.
5. **Capture** shows the camera with the pre-flight check. Shutter → the photo is taken and
   SHA-256 hashed → upload → extraction → review, where **your actual photo** appears above the
   fields. The fields themselves are sample data and the screen says so.

Also worth showing: **estimated deductions of $50,570** against the engine's published band of
$40,000–55,000 for a line-haul truckie, and the **Caps applied** card, which names every ATO limit
the estimate respects (TD 2025/4). That card is what convinces an accountant.

---

## Where the numbers come from

Every monetary figure is **computed, not typed**. `apps/server/scripts/gen-demo-fixtures.ts` builds
`src/fixtures/demo.ts` using:

- `@snap/tax-engine` at **TD 2025/4, FY 2025-26** for the deduction estimate and every cap;
- exact **1/11** GST on scaled `BigInt` — never a float.

Regenerate after any rate change:

```bash
pnpm --filter @snap/server gen:demo
```

This matters because a finance agency in the room will check the arithmetic. $1,848.00 − $168.00 =
$1,680.00, and $1,848.00 ÷ 11 = $168.00 exactly.

The app is clearly marked **“Demo data”** on the Position screen so it can never be mistaken for a
live client file.

---

## Architecture

```
src/
  app/                  Expo Router routes
    _layout.tsx         root stack; paints the ground for both themes
    (tabs)/
      index.tsx         Position — the lead screen
      capture.tsx       camera + pre-flight check
      documents.tsx     receipts list with filters
    document/[id].tsx   review: edit, confirm, post
  api/
    types.ts            SnapApi — THE SEAM. Screens import nothing else.
    mock.ts             demo implementation over the generated fixtures
    index.ts            the one place a backend is chosen
  components/ui.tsx     shared primitives
  theme/                ledger palette, spacing, type
  fixtures/demo.ts      GENERATED — do not edit
```

### Swapping in the real server

Add `HttpApi implements SnapApi` and switch the factory in `src/api/index.ts`. **No screen
changes** — no screen imports anything but `@/api`. Also set `IS_DEMO = false` there, which removes
the “Demo data” badge.

Because both sides implement `@snap/api-contract`, a mismatch between app and server is a
compile error rather than a production surprise.

---

## Why extraction is not on the device

The on-device work is a **pre-flight check only** — is this a document, is it legible. Extraction is
a versioned server-side function of the stored original so it can be **re-run when the model
improves**. If the device extracted, historical records would be frozen at whatever the app shipped
with and no backfill would ever be possible.

The same reasoning keeps the tax engine off the device: **its ATO rates change every 1 July.** In
the app, a rate change needs an App Store release and every user who has not updated silently
computes the wrong deductions. On the server it is a deploy.

---

## Verified

- `tsc --noEmit` clean (TypeScript 6, strict)
- `expo export` bundles for web with no errors
- Driven end to end in Chromium at iPhone 14 Pro size: Position → filtered receipts → review of the
  >$1,000 invoice → capture. No console or page errors.
- **Both themes checked.** Two real bugs were found this way and fixed: the root ground was unpainted
  (dark mode put light ink on a white masthead), and a `tabBarItemStyle` override was suppressing the
  tab labels.
- Icons generated to the product palette (`assets/`), splash and favicon wired, `eas.json` present
  with a `preview` profile for internal distribution (Android APK, ad-hoc iOS).

## Seeing it on a phone

### Android emulator (works on Windows)

The SDK lives at `%LOCALAPPDATA%\Android\Sdk`. Set these once, per shell or in your user
environment:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```

```powershell
emulator -list-avds                                        # see what exists
emulator -avd snap_pixel -gpu swiftshader_indirect         # boot it
adb devices                                                # confirm it attached
pnpm --filter @snap/mobile android                         # install + open
```

An AVD named **`snap_pixel`** is already created: Pixel 8, Android 16 (API 36), x86_64.

#### If the emulator window is black

**`-gpu swiftshader_indirect` is not optional on this machine.** With the default `-gpu auto` the
emulator boots correctly and `adb` reports it healthy, but nothing composites into the host window —
you get a black rectangle. It is a host-GPU problem, not a boot failure, and the way to tell the
difference is to grab the framebuffer directly:

```powershell
adb exec-out screencap -p > emu.png     # renders fine even when the window is black
```

If that image has content, the emulator is running and only the window is broken; relaunch with
software rendering. Cold boot takes ~4 minutes, warm boot ~35 seconds.

### iPhone

**There is no iOS simulator on Windows** — it ships inside Xcode and is macOS-only. Three real
options:

| Option | Effort | Notes |
|---|---|---|
| **Expo Go on a real iPhone** | 2 min | `pnpm start`, scan the QR. Real camera. Best for a demo. |
| EAS build → TestFlight | ~30 min | `eas build -p ios --profile preview`. Needs an Apple Developer account. |
| Appetize.io / BrowserStack | ~20 min | Browser-embedded iOS device; gives investors a shareable link. |

For the client demo, **Expo Go on their own handset** beats any emulator: it is the real camera on
real hardware, and they can hold it.

---

## Known limits

- **Extraction returns sample fields.** The capture is real — the photo is taken, the bytes are
  hashed with SHA-256, and the review screen shows *your* image — but there is no extraction service
  yet, so the fields are sample data. The review screen says so explicitly with a **Demo extraction**
  notice rather than implying it read that particular receipt.
- **Not yet run on a physical handset.** Verified via TypeScript strict compilation, Metro bundling,
  and a scripted walkthrough in Chromium at iPhone 14 Pro dimensions (13 captures, 0 failures, 0
  console errors). Run it on real hardware before the demo.
- `expo-camera` has no meaningful web implementation; Capture shows a framing placeholder on web and
  the real AVFoundation/CameraX viewfinder on a device.
- No auth, no persistence — session state resets on reload. Correct for a demo, not for a pilot.
- No mobile tests. The workspace has 297, none of which touch a screen.
