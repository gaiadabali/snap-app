# Getting the app onto a phone

Everything below has been run except the two steps that need Hansel's own Expo
account, which are marked. Where a step was verified, what it produced is
stated — a build document that has never been executed is a wish list.

---

## What is already true

| Check | Result |
|---|---|
| `npx expo-doctor` | **21/21 pass** |
| `npx expo export --platform web` | **2.3 MB bundle, no errors** |
| Production bundle against the real API | **21 screens, 79 API calls, 0 failing, no console errors** |
| `npx expo prebuild --platform android` | **native project generated, every config plugin resolved** |

The last one is the closest thing to a native build that runs without an Expo
account: it is the step where a misconfigured config plugin fails, and it
passes. The generated `android/` directory was then **deleted on purpose** —
see "Why there is no android/ directory" below.

---

## 1. The one thing that needs an account

`app.json` has no `extra.eas.projectId`, because a project id is issued by
Expo against a specific account and cannot be invented. Nothing else is
missing.

```bash
cd apps/mobile
npx eas login          # Hansel's account
npx eas init           # writes extra.eas.projectId into app.json
```

Everything after this point works.

---

## 2. Build profiles

`eas.json` defines four, and the difference between them is one environment
variable that **cannot be changed after the build**:

| Profile | `EXPO_PUBLIC_API_URL` | For |
|---|---|---|
| `demo` | *(empty)* | Fixtures only. No server, no network, works on a plane. |
| `development` | `http://<LAN ip>:4000` | A dev client talking to a server on this machine. |
| `preview` | staging | An APK to put in someone's hands. |
| `production` | production | The real thing. |

```bash
npx eas build --profile preview --platform android
```

### The mistake this section exists to prevent

`EXPO_PUBLIC_API_URL` is **inlined into the JavaScript bundle at build time**.
It is not read from the device, and it cannot be overridden by the app.

So a build made with `http://127.0.0.1:4000` works perfectly in a simulator —
which shares the host's loopback — and fails on a real phone with a network
error that looks exactly like the server being down. On the phone, `127.0.0.1`
*is the phone*.

For a build you intend to install on hardware, use the host's LAN address
(`ipconfig` on Windows), and give the server that origin:

```bash
CORS_ORIGINS='http://192.168.1.10:8081' pnpm --filter @snap/server dev
```

The server already listens on `0.0.0.0`, so nothing else is needed. An empty
value is not "no server" by accident — it is the deliberate demo mode in
`src/api/index.ts`, which runs on fixtures and marks every screen with a Demo
chip so a demo is never mistaken for someone's real tax position.

---

## 3. Why there is no `android/` directory

Expo calls this continuous native generation: the native projects are
**derived** from `app.json` and its config plugins, and EAS regenerates them
on every build. Committing a copy means a change to `app.json` — a permission
string, an icon, a plugin — silently stops taking effect, and the difference
shows up as a build that ignores your edit for no visible reason.

`prebuild` is still worth running locally to check the config, which is what
was done here. `.gitignore` covers `/android`, `/ios` and `/dist`.

---

## 4. Running the web build locally

Not a deployment target — a fast way to exercise the real bundle:

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL='http://127.0.0.1:4000' npx expo export --platform web
```

`web.output` is `single`, so it is a single-page app: a static server must
fall back to `index.html` for unknown paths or every deep link 404s. Add the
serving origin to `CORS_ORIGINS`.

---

## 5. What has still never happened

**Nobody has run this on a physical device.** Everything above is a headless
browser and a config check. The things that only a real phone can answer are
therefore all still open:

- Camera capture against a real receipt, in the lighting this app is for.
- GPS trip recording while actually moving — `geo.ts` is unit-tested against
  synthetic fixes and has never seen a real GPS trace.
- Scroll performance over the ~950-document timeline on a mid-range Android.
- Memory: the headless renderer **crashed** partway through a full sweep of
  the dev bundle once the screens started loading real page images. The
  production bundle survived the same sweep, and each affected screen renders
  fine alone, so this is not a broken screen — but it is a signal that the app
  may hold full-size images longer than it needs to, and a phone has far less
  headroom than a desktop browser.

Treat the first device run as a source of findings, not a formality.

---

## 6. Getting a demo build onto a phone (2026-09-14)

`expo-doctor` passes 21/21 and `expo export --platform web` bundles clean, so
the app itself is build-ready. Two things stand between that and an APK.

### 1. The project id — the only step needing your account

`app.json` still has no `extra.eas.projectId`. A project id is issued by Expo
against a specific account and cannot be invented, so nobody but you can do
this:

```bash
cd apps/mobile
npx eas login
npx eas init      # writes extra.eas.projectId into app.json
```

Everything after this works.

### 2. Each profile now declares its API URL, and that was silently missing

`EXPO_PUBLIC_API_URL` is **inlined into the JavaScript bundle at build time**.
It is not read from the device and cannot be changed after the build — §2 of
this document already warned about that, but no profile in `eas.json` actually
set it. A `preview` APK built before 2026-09-14 therefore fell back to the
empty default and ran entirely on **fixtures**: it would have looked completely
healthy in a demo while touching no server at all, which is a worse failure
than a crash.

Every profile now names its own value:

| Profile | `EXPO_PUBLIC_API_URL` | For |
|---|---|---|
| `demo` | *(empty)* | Fixtures only. No server, works on a plane. |
| `development` | LAN address | A dev client against a server on your machine. |
| `preview` | staging | **The investor/demo APK.** |
| `production` | production | The real thing. |

`preview` and `production` carry `REPLACE-WITH-...` placeholders. Replace the
`preview` one with the staging API hostname once the VPS has its temporary
domain (`docs/DEPLOY.md` §9), then:

```bash
npx eas build --profile preview --platform android
```

Build `preview` for the demo, not `demo` — the whole point is showing the app
against the real server.

### iOS

Unchanged and still not side-loadable: TestFlight, then the App Store. The
website's download page states this honestly and its structured data marks iOS
as unreleased — see `docs/WEB.md` §7.

---

## 7. Version, build number and updates (task 1.12, 2026-10)

Until 2026-10 every build ever made said `0.1.0` with Android `versionCode` 1,
because nothing changed either, so the in-app update card had to compare
commits and could tell a tester on a NEWER build to "update" to an older one.
Now every build is numbered, and the app offers a build only when it is newer.

### Where the number comes from

`apps/mobile/app.config.js` (Expo's dynamic config, reading `app.json`) sets:

| Field | Value | Example |
|---|---|---|
| `android.versionCode` | `git rev-list --count HEAD` | `219` |
| `version` | `app.json` major.minor + that count | `0.1.219` |
| `extra.versionCode` | the same number, for the app to read | `219` |

The rules live in the pure function `apps/mobile/build-version.cjs`
(`computeBuild`, tested in `build-version.test.ts`). To move the major or minor
number, edit `expo.version` in `app.json`; the count always supplies the patch.

- **Override:** `SNAP_BUILD_NUMBER=<n>` replaces the commit count (CI, EAS).
- **Shallow clones fail loudly.** `git rev-parse --is-shallow-repository` true
  with no override stops the build, because a shallow clone counts 1 and would
  produce a build Android treats as older than everything installed. Run
  `git fetch --unshallow`, or set `SNAP_BUILD_NUMBER`. CI builds must do one or
  the other (`fetch-depth: 0` is the usual fix).
- **No git at all** (the web image, which does not copy `.git`) also fails
  unless the override is set; `apps/mobile/Dockerfile` sets `SNAP_BUILD_NUMBER=1`
  because a web export has no versionCode that anything reads.
- **EAS:** `eas.json` now has `appVersionSource: "local"` and no `autoIncrement`,
  so EAS uses `app.config.js` instead of its own remote counter. EAS uploads
  without git history, so give it the number: `SNAP_BUILD_NUMBER=$(git rev-list
  --count HEAD) npx eas build ...`.
- `expo prebuild` writes it: `android/app/build.gradle` gets
  `versionCode 219` and `versionName "0.1.219"` (checked).

### How the running app knows its own number

`deploy/build-apk.sh` computes it from `app.config.js` and inlines it as
`EXPO_PUBLIC_BUILD_VERSION_CODE`, the same way `EXPO_PUBLIC_BUILD_COMMIT` is
inlined. If that is absent the app falls back to `extra.versionCode`, which
`expo-constants` embeds in the APK from the same config. No native module was
added (`expo-application` would give the native value but is not a dependency).
Expo Go, `__DEV__` bundles and the web build report "unknown", and an app that
does not know its number never offers or requires an update. Settings > App
version shows version, build and commit.

### Publishing

`deploy/publish-apk.sh` now reads `version` and `versionCode` from the APK
itself (`assets/app.config`), writes both into `manifest.json`, and **refuses to
publish a `versionCode` that is not greater than the one already live**. It also
refuses an APK that has none. The manifest still carries `buildNumber` and
`commit` exactly as before, because installs already in the field read them.

### Update card, and minimum supported build

- The card (all home screens) appears only when the manifest's `versionCode` is
  greater than the app's. Missing on either side means no card. A dismissal is
  remembered per versionCode.
- `ANDROID_MIN_VERSION_CODE` (server setting, `deploy/.env`, default `0` = no
  minimum) is served as `minVersionCode` in
  `GET /v1/downloads/android/manifest`. An app whose own versionCode is below it
  shows a full-screen "Update required" with a download button and no way past
  it, checked at launch and when the app returns to the foreground. Raise it
  only to a number the published build already meets, or people are blocked
  with nothing newer to install. It does nothing while no build is published.
