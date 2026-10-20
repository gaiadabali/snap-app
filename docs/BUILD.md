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

> **Which path ships the Android APK?** The tag workflow in section 8
> (`.github/workflows/android-release.yml`). Everything about EAS in sections
> 1, 2 and 6 describes `mobile-build.yml`, which has never run and stays unused
> until someone runs `eas init` and adds an `EXPO_TOKEN`.

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

### Release notes and release history (task 1.12.d, 1.12.j, 1.12.k)

Every published build says what changed, in words a customer understands. The
same entry is the "What's new" on the website, on the in-app update card and
the blocking update screen, and the release notes for Google Play (8.4).

**The words live in the repo.** `apps/mobile/release-notes.json` is a list,
newest first. Each entry is `{ id, date, notes }`: a short stable `id` (a slug),
the `date` it was written (YYYY-MM-DD), and `notes`, 2 to 5 plain sentences in
one paragraph and at most 500 characters in all (Google Play's limit). They are
reviewed in the release PR. Entries are NOT keyed by versionCode: the versionCode
is the commit count at build time and the release PR's own squash merge changes
it, so nobody can know the number while writing the entry. Commit subjects are
not customer copy ("Revert ...", "The gap check counts in BigInt"); rewrite them.
Avoid abbreviations with full stops (e.g.), because a sentence ends at one.

**The server holds the history.** `releases.json` sits beside `manifest.json`
under `downloads/android/`: `[{ id, versionCode, version, commit, publishedAt,
notes }]`, newest first. It is the authority on which build an entry became.
`GET /v1/downloads/android/releases` serves it: only entries up to the build
being served, newest first, with `current: true` on the one `latest.apk` serves
(the only build still downloadable). A missing or corrupt file is an empty list,
never a 500. The download page reads it live (`cache: 'no-store'`, like the
manifest), so the log changes the moment a build is published, with no website
deploy. The manifest also carries the entry's `notes`, which is what the update
card shows. The build served before this scheme (e228773) has no entry and is
not backfilled; history starts with the first build published under it.

**Publishing.** `deploy/release-notes.mjs` holds every rule (validation, which
entry, the draft). Both ways of releasing (section 8: a tag, or `publish-apk.sh`
from a laptop) end in `deploy/place-apk.sh` on the host, which calls
`release-notes.mjs plan` (see its header). The
newest entry is taken. If its `id` is already attached to a published build the
publish is REFUSED before anything is written to the live directory, and the commit subjects since the
last published commit (limited to `apps/mobile` and `packages`) are printed as a
draft to rewrite. Otherwise the APK is uploaded, then `releases.json`, then
`manifest.json`, each written to a `.part` file and moved into place. A publish
that dies after `releases.json` shows nothing new (the API lists nothing ahead of
the manifest) and can simply be run again: the same versionCode resumes.
`test/release-notes.test.ts` validates the real file, so a bad entry fails CI in
the release PR.

**Release operator.** Before a release PR merges: add an entry at the top of
`apps/mobile/release-notes.json` with a new `id`, today's date and 2 to 5
sentences. After it merges, tag the merge commit (section 8). If the release is
refused with "already attached", write the next entry and tag again.

**Android minimum.** The APK installs on Android 7.0 (minSdk 24): React Native
0.86's default, with no override in `app.json` or `app.config.js` and no
`expo-build-properties`; `snap-ocr`'s own `minSdkVersion 24` matches. The site
used to say 8.0.

---

## 8. Releasing the Android app from CI (task 1.12.b, 2026-10)

Nobody builds on a laptop any more. A tag makes CI build the APK and attach it to
a GitHub Release, and the deploy host pulls that release by itself.

```
 you: add a release note, merge the PR
 you: git tag android-v0.1.<N> <merge commit>; git push origin android-v0.1.<N>
 CI (.github/workflows/android-release.yml): build -> verify -> GitHub Release
 host (deploy/pull-apk.sh, run by the poller every minute): see a newer release
      -> download -> check -> place -> the API serves it (/v1/downloads/android/*)
```

**Pull, not push.** CI holds no SSH key, host address or deploy credential. Its
only write access is creating a release in this repository (`contents: write`,
granted to the `release` job alone; the workflow default is read-only). The host
reads the PUBLIC release and places the APK itself, the same model as
`poll-deploy.sh`. A compromised runner can at worst publish a release, and the
host checks that release before using it.

### How to release

1. **Write the notes.** In a PR, add an entry at the top of
   `apps/mobile/release-notes.json` (new `id`, today's date, 2 to 5 sentences a
   customer understands; see section 7). `test/release-notes.test.ts` and the
   workflow both validate it. Merge the PR.
2. **Find the tag name.** It is `android-v` plus the APK's own version, which is
   `<major.minor from app.json>.<git rev-list --count of the commit>`:
   ```
   git fetch origin
   echo "android-v0.1.$(git rev-list --count origin/main)"
   ```
   (The release PR's own squash merge changes the count, which is why the notes
   are not keyed by it.) If `major.minor` in `apps/mobile/app.json` is not 0.1,
   use that instead. The workflow refuses a tag that does not match, and says what
   it should be.
3. **Tag and push** that commit: `git tag <tag> origin/main && git push origin <tag>`.
   The tag must be on `main`; the workflow refuses one that is not.
4. **Watch** the "Android release" run (about 20 to 30 minutes). On success there
   is a release named "Android 0.1.N" with three assets: `snap-apps-android.apk`,
   `snap-apps-android.apk.sha256` and `build.json` (version, versionCode, commit,
   API URL, sha256, and the notes entry it carries).
5. **The host picks it up within about a minute** of the release being published.
   `journalctl -u snap-deploy.service | grep pull-apk` shows `placed android-v...`;
   `curl -s https://snap-apps-api.gaiada.com/v1/downloads/android/manifest` shows it.

A run of the workflow WITHOUT a tag (a pull request touching the build, or "Run
workflow") builds the APK, runs every check and keeps the APK as a workflow
artifact for 14 days. It never creates a release. That is how a change to the
build is proven before it merges.

### What CI checks

Before the long build, on a tag: the tag is on `main`, matches the version
`app.config.js` computes, the versionCode is above the live one, and the newest
release note is not already published (read from the public
`GET /v1/downloads/android/releases`). After the build: the bundle contains the
API URL; `assets/app.config` carries the commit count of the checkout as its
versionCode; and the APK is signed by the expected certificate (below).

### What the host does (`deploy/pull-apk.sh`)

Called from `poll-deploy.sh` on every tick, under its lock, and it can never fail a
deploy. In steady state it costs one conditional GitHub request that returns 304 and
is free (the ETag is kept in `/var/lib/snap-apps/apk-releases.etag`). It acts on the
newest `android-v*` release that is **published and not a prerelease** (a draft is
unfinished; a prerelease is the way to say "not for testers yet") and has all three
assets, and only when its versionCode is above the manifest's. It then verifies the
sha256 two ways, that the API URL is the expected one, the APK's embedded
versionCode and version, and the notes rule, and places the APK, then
`releases.json`, then `manifest.json`, each atomically. A bad download is retried on
the next tick; a refusal is logged once. `DRY_RUN=1 deploy/pull-apk.sh` shows what it
would do and writes nothing. `SKIP_APK_PULL=1` in the poller's environment turns it off.
To make it look again at an unchanged release list, delete the ETag file.

**One implementation of the rules.** `deploy/place-apk.sh` runs ON THE HOST and does
the checking and the writing. `pull-apk.sh` calls it locally; `publish-apk.sh` (the
laptop path, still available when CI is down) uploads the APK, the notes and its own
copies of `place-apk.sh` and `release-notes.mjs` to a staging directory and runs it
over ssh. A build is refused or accepted the same way on both. One difference from
before: the laptop path now uploads the APK before a refusal, because the checks run
on the host; the live files are untouched by a refusal, and the staging copy is removed.

### Rolling back

Never publish a LOWER versionCode: Android will not install it over a higher one, and
the server refuses it. To roll back, make a new commit that reverts the change (`git
revert`), add a release note saying what testers get, merge, and tag as above. The
rollback is a new, higher build with the old behaviour.

### Signing

Every APK is signed with the public React Native debug key (`CN=Android Debug`),
which `expo prebuild` copies from its template; there is no keystore in the repository.
Testers install each build over the last, and Android allows that only for the same
signer, so CI refuses an APK signed by anything else. The certificate's SHA-256 is
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, the same as the
build now served. Task 8.1 will replace it with a private key held as a CI secret:
the seam is `EXPECTED_SIGNER_SHA256` and the step before "Build" in the workflow, and
testers must uninstall once when it changes. It is not implemented.

### One-time setup (an operator, once, after this merges)

1. **Node 20 or newer on the host**, with `unzip` and `curl`. `place-apk.sh` and
   `pull-apk.sh` use node (`release-notes.mjs` has no dependencies). Check:
   `node -v && unzip -v | head -1 && curl --version | head -1`.
2. **Let the poller reach the new scripts.** Nothing to install: they sit beside
   `poll-deploy.sh`, and the repo checkout there is updated by the next deploy.
   Unit files are unchanged, so no `daemon-reload`. (`poll-deploy.sh` itself must be
   the new version first, so the first release may need one extra deploy tick.)
3. **Check the placement directory.** `deploy/.env` must set `STORAGE_HOST_DIR`
   (it already does: `/opt/snap-apps/data/storage`) and `/var/lib/snap-apps` must be
   writable by the poller's user. Try it:
   `DRY_RUN=1 /opt/snap-apps/deploy/pull-apk.sh` (prints nothing when there is no
   release yet).
4. **In GitHub (repo admin):** add a tag ruleset for `android-v*` so that only
   maintainers can create one (Settings, Rules, Rulesets). Whoever can push such a tag
   can ship an APK to testers, and the host trusts the release it produces.
5. **Optional:** `EXPECTED_API_URL` and `REPO_SLUG` default to
   `https://snap-apps-api.gaiada.com` and `gaiadabali/snap-app`; set them in a
   systemd drop-in only if either changes.

## 9. Google Play (decided by the owner, 2026-10-21)

Group plan 0.12. Nothing below is set up yet; this is what the Play work
(group plan Phase 8) builds to.

- **Publisher: an organisation developer account** for the company that owns
  Snap Apps. It needs a D-U-N-S number and the website verified in Search
  Console, and it is widely reported to skip the 12-testers-for-14-days closed
  test that new personal accounts must pass.
- **Purchases: Google Play Billing** in the Play build. At about 10c a scan, a
  credit still keeps about 2.9c after Google's fee, GST and the 3c YourTal point.
- **Contact email for the listing and for account-deletion requests:
  hansel@gaiada.com** for now. The support addresses have no mailbox, and Play
  requires one that works.
- **The website APK stays, for testers,** signed with the same key as the Play
  build, so a tester can move to Play later without losing data.
