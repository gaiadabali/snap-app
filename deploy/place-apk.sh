#!/usr/bin/env bash
# Put an APK where the API serves it, applying EVERY rule about what may go live.
#
#   deploy/place-apk.sh --apk FILE --notes FILE --commit SHA --api-url URL --dir DIR
#                       [--expect-version-code N] [--expect-version V]
#
# THE ONE IMPLEMENTATION. This runs ON THE DEPLOY HOST, and both ways of
# releasing call it: `publish-apk.sh` (a person's laptop, over ssh) and
# `pull-apk.sh` (the host's own poller, fed by a GitHub Release). Whatever
# refuses a build here refuses it on both paths, because there is no second
# copy of the rules to drift. It needs node, unzip and sha256sum, and sits
# beside release-notes.mjs, which it calls.
#
#   --apk      the APK to place
#   --notes    a release-notes list (newest entry first) in the format of
#              apps/mobile/release-notes.json; the newest entry is the one this
#              build carries
#   --commit   the commit the APK was built from, recorded in the manifest
#   --api-url  the API the bundle must have been built against
#   --dir      the directory the API serves: <STORAGE_DIR>/downloads/android
#   --expect-* optional: refuse when the APK's own version / versionCode differ
#              from what the caller was told (pull-apk passes build.json's)
#
# WHAT IT REFUSES (exit 1, nothing written; every one is permanent for that APK):
#   - the bundle does not contain the API URL (it would run on fixtures)
#   - the APK carries no versionCode or version, or not the expected ones
#   - the versionCode is not ABOVE the one already live (never go backwards:
#     Android will not install a lower build over a higher one)
#   - the newest release note is already attached to a published build
# Exit 2 is a usage or environment problem (missing tool, lock held, a copy that
# did not verify), and may be retried. Exit 0: placed, or DRY_RUN=1 and it would.
#
# ORDER, and why. The APK first, then releases.json, then manifest.json, each
# written to a `.part` file and moved into place on the same filesystem. The
# manifest is what makes a build visible, so it goes LAST. The API lists nothing
# ahead of the manifest's versionCode, so a run that dies between writes shows
# nothing new, and running it again resumes: release-notes.mjs accepts an entry
# already attached to this very versionCode.
#
# DRY_RUN=1 runs every check and the plan and writes nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTES_MJS="$SCRIPT_DIR/release-notes.mjs"

APK="" NOTES="" COMMIT="" API_URL="" DIR="" EXPECT_CODE="" EXPECT_VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apk) APK="${2:-}"; shift 2 ;;
    --notes) NOTES="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --expect-version-code) EXPECT_CODE="${2:-}"; shift 2 ;;
    --expect-version) EXPECT_VERSION="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$APK" ] || [ ! -f "$APK" ] || [ -z "$NOTES" ] || [ ! -f "$NOTES" ] \
   || [ -z "$COMMIT" ] || [ -z "$API_URL" ] || [ -z "$DIR" ]; then
  echo "usage: place-apk.sh --apk FILE --notes FILE --commit SHA --api-url URL --dir DIR" >&2
  exit 2
fi
for tool in node unzip sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required on this host to place an APK" >&2; exit 2; }
done
DRY_RUN="${DRY_RUN:-}"
log() { echo "[place-apk] $*"; }

# One placement at a time: the poller and a person's laptop must not interleave
# their writes. Not available under DRY_RUN, which writes nothing (not even the
# lock file).
if [ "$DRY_RUN" != "1" ]; then
  mkdir -p "$DIR"
  if command -v flock >/dev/null 2>&1; then
    exec 8>"$DIR/.place.lock"
    flock -n 8 || { echo "another placement is in progress in $DIR" >&2; exit 2; }
  fi
fi

# THE ARTEFACT MUST ACTUALLY POINT SOMEWHERE. `EXPO_PUBLIC_API_URL` is inlined
# into the JS bundle at build time; without it `api()` falls back to FIXTURES
# and a release APK runs on invented data. One shipped once and was caught only
# because somebody noticed a "Demo" chip. So this greps the BUNDLE for the URL
# rather than trusting the environment that built it. `grep -c`, not `-q`: with
# pipefail `-q` exits at the first match, unzip takes SIGPIPE, and the pipeline
# reports failure on a perfectly good APK.
BUNDLE_HITS=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -cF "$API_URL" || true)
if [ "${BUNDLE_HITS:-0}" -lt 1 ]; then
  echo "This APK does not contain $API_URL." >&2
  echo "It was built without the variable set, so it runs on FIXTURES." >&2
  exit 1
fi
log "verified: the bundle contains $API_URL"

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c%s "$APK")

# VERSION AND BUILD NUMBER ARE READ FROM THE APK, not the working tree. It embeds
# the config it was built with (assets/app.config, from apps/mobile/app.config.js),
# so this records what the artefact IS.
APK_CONFIG=$(unzip -p "$APK" assets/app.config 2>/dev/null || true)
# One node call; two lines out: versionCode, then version (either may be empty).
{ read -r VERSION_CODE; read -r VERSION; } < <(printf '%s' "$APK_CONFIG" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const c=JSON.parse(s);
console.log(String((c.android&&c.android.versionCode)||(c.extra&&c.extra.versionCode)||''));
console.log(String(c.version||''))}catch{console.log('');console.log('')}})")
case "$VERSION_CODE" in
  ''|*[!0-9]*|0)
    echo "This APK carries no usable versionCode (got '$VERSION_CODE') - refusing to publish." >&2
    echo "Build it with deploy/build-apk.sh (apps/mobile/app.config.js sets it)." >&2
    exit 1 ;;
esac
if [ -z "$VERSION" ]; then
  echo "This APK carries no version - refusing to publish." >&2
  exit 1
fi
if [ -n "$EXPECT_CODE" ] && [ "$EXPECT_CODE" != "$VERSION_CODE" ]; then
  echo "Refusing: the APK says versionCode $VERSION_CODE but it was announced as $EXPECT_CODE." >&2
  exit 1
fi
if [ -n "$EXPECT_VERSION" ] && [ "$EXPECT_VERSION" != "$VERSION" ]; then
  echo "Refusing: the APK says version $VERSION but it was announced as $EXPECT_VERSION." >&2
  exit 1
fi

# NEVER GO BACKWARDS. The update check offers a build only when its versionCode
# is greater than the installed one, and Android refuses to install a lower one,
# so an older or equal build would strand every tester on a build they cannot
# replace. No manifest yet (first publish) is fine; one from before versionCodes
# existed has none, so any numbered build is higher than it.
CURRENT_MANIFEST=$(cat "$DIR/manifest.json" 2>/dev/null || true)
CURRENT_CODE=$(printf '%s' "$CURRENT_MANIFEST" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=Number(JSON.parse(s).versionCode);console.log(Number.isInteger(v)&&v>0?v:0)}catch{console.log(0)}})")
if [ "$VERSION_CODE" -le "$CURRENT_CODE" ]; then
  echo "Refusing to publish versionCode $VERSION_CODE: the server already has $CURRENT_CODE." >&2
  echo "A published build must be NEWER. Commit your work and rebuild, or set a higher SNAP_BUILD_NUMBER." >&2
  exit 1
fi

# RELEASE NOTES. Validate, take the newest entry, and refuse when it is already
# attached to a published build, all before anything is written. The plan writes
# the next releases.json and manifest.json into a temp dir; they move into place
# below, after the APK.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cat "$DIR/releases.json" > "$WORK/releases.current.json" 2>/dev/null || : > "$WORK/releases.current.json"
printf '%s' "$CURRENT_MANIFEST" > "$WORK/manifest.current.json"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if ! node "$NOTES_MJS" plan \
    --notes "$NOTES" \
    --releases "$WORK/releases.current.json" \
    --manifest "$WORK/manifest.current.json" \
    --out-releases "$WORK/releases.json" \
    --out-manifest "$WORK/manifest.json" \
    --version "$VERSION" --version-code "$VERSION_CODE" --commit "$COMMIT" \
    --published-at "$NOW" --sha256 "$SHA" --size "$SIZE" --api-url "$API_URL"; then
  echo "Nothing was published." >&2
  exit 1
fi

log "$(basename "$APK")"
log "  version   $VERSION (versionCode $VERSION_CODE, live: $CURRENT_CODE)"
log "  commit    $COMMIT"
log "  sha256    $SHA"
log "  size      $SIZE bytes"
log "  built for $API_URL"
log "  to        $DIR"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN: would place versionCode $VERSION_CODE; nothing was written"
  exit 0
fi

# APK first. `.part` then move, so a half-copied file is never the live one even
# for the instant before the manifest lands.
cp "$APK" "$DIR/snap-apps-android.apk.part"
mv "$DIR/snap-apps-android.apk.part" "$DIR/snap-apps-android.apk"

# Verify what landed rather than assuming cp told the truth. A truncated copy
# that still gets a manifest is a download that installs and crashes.
PLACED_SHA=$(sha256sum "$DIR/snap-apps-android.apk" | cut -d' ' -f1)
if [ "$PLACED_SHA" != "$SHA" ]; then
  echo "checksum mismatch after copy: source $SHA, placed $PLACED_SHA" >&2
  echo "the manifest was NOT written, so nothing is being advertised" >&2
  exit 2
fi

# Then the history, then the manifest, which makes the build visible.
put_atomic() { cp "$1" "$DIR/$2.part" && mv "$DIR/$2.part" "$DIR/$2"; }
put_atomic "$WORK/releases.json" releases.json
put_atomic "$WORK/manifest.json" manifest.json

log "placed versionCode $VERSION_CODE ($VERSION)"
