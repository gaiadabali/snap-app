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
