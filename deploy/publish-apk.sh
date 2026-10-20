#!/usr/bin/env bash
# Put an Android build on the deploy host, where the API serves it.
#
#   deploy/publish-apk.sh path/to/app-release.apk [commit-sha]
#
# WHY THIS EXISTS RATHER THAN A COMMIT. The APK is ~50MB and is rebuilt several
# times a day during alpha. `apps/web/public` would put every one of those in
# git history permanently; GitHub Releases would keep history clean but the
# repository is private, so every tester would need a GitHub account. The host
# already has a storage volume and already terminates TLS, so the artefact
# goes there and `ReleasesController` serves it from a stable URL.
#
# TWO FILES, AND THE ORDER MATTERS. The APK is uploaded FIRST and the manifest
# SECOND, because the manifest is what makes the download visible: writing it
# first would advertise a build that is still copying. The controller also
# re-checks that the APK exists before trusting the manifest, so a crash
# between the two reads as "nothing published" rather than as a 404 download.
#
# Requires: ssh access to the deploy host. Set SNAP_DEPLOY_HOST, or pass it in
# the environment:
#
#   SNAP_DEPLOY_HOST=user@host deploy/publish-apk.sh app-release.apk
set -euo pipefail

APK="${1:-}"
COMMIT="${2:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
HOST="${SNAP_DEPLOY_HOST:-}"
# Must match STORAGE_HOST_DIR in deploy/docker-compose.yml — the same directory
# the API container sees as STORAGE_DIR.
# Verified against the host rather than guessed: deploy/.env sets
# STORAGE_HOST_DIR=/opt/snap-apps/data/storage, and writing a file inside the
# API container at /data/storage confirmed it lands there. The first version of
# this script guessed /srv/snap/storage, which would have uploaded the APK into
# a directory nothing serves — a publish that reports success and changes
# nothing.
REMOTE_STORAGE="${SNAP_STORAGE_HOST_DIR:-/opt/snap-apps/data/storage}"
REMOTE_DIR="${REMOTE_STORAGE}/downloads/android"

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "usage: deploy/publish-apk.sh <path-to-apk> [commit-sha]" >&2
  exit 2
fi
if [ -z "$HOST" ]; then
  echo "SNAP_DEPLOY_HOST is not set (e.g. SNAP_DEPLOY_HOST=root@helios)" >&2
  exit 2
fi

# THE ARTEFACT MUST ACTUALLY POINT SOMEWHERE.
#
# `EXPO_PUBLIC_API_URL` is inlined into the JS bundle at build time. When it is
# unset, `api()` falls back to the FIXTURE implementation and the app runs on
# invented data — a release APK that opens on a made-up budget and never
# contacts the server. That shipped once, was installed on a handset, and was
# only caught because somebody noticed a "Demo" chip in the corner.
#
# So this greps the bundle for the URL rather than trusting the environment
# that built it. The environment variable says what SHOULD have happened; the
# bundle says what DID. Verified to discriminate: the fixtures-only build gives
# zero matches, a correctly-built one gives at least one.
if [ -z "${EXPO_PUBLIC_API_URL:-}" ]; then
  echo "EXPO_PUBLIC_API_URL is not set — refusing to publish." >&2
  echo "Without it the bundle runs on fixtures and never contacts the server." >&2
  exit 2
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to verify what is inside the APK" >&2
  exit 2
fi
# `grep -cF`, not `grep -qF`. With `set -o pipefail`, `-q` exits at the first
# match, `unzip` takes SIGPIPE and dies non-zero, and the pipeline reports
# FAILURE on a perfectly good APK — a guard that rejects everything, which is
# worse than no guard because it teaches people to skip it. `-c` reads its
# input to the end, so unzip finishes cleanly.
BUNDLE_HITS=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -cF "$EXPO_PUBLIC_API_URL" || true)
if [ "${BUNDLE_HITS:-0}" -lt 1 ]; then
  echo "This APK does not contain $EXPO_PUBLIC_API_URL." >&2
  echo "It was built without the variable set, so it runs on FIXTURES." >&2
  echo "Rebuild with: EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL ./gradlew :app:assembleRelease" >&2
  exit 1
fi
echo "verified: the bundle contains $EXPO_PUBLIC_API_URL"

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c%s "$APK")
# THE VERSION AND BUILD NUMBER ARE READ FROM THE APK, not from the working tree
# or app.json. The APK embeds the config it was built with (`assets/app.config`,
# written by expo-constants from apps/mobile/app.config.js), so this records
# what the artefact IS rather than what the checkout says now. A build with no
# versionCode cannot take part in "offer only a newer build", so it is refused.
APK_CONFIG=$(unzip -p "$APK" assets/app.config 2>/dev/null || true)
read_cfg() { printf '%s' "$APK_CONFIG" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const c=JSON.parse(s);console.log($1)}catch{console.log('')}})"; }
VERSION_CODE=$(read_cfg "c.android&&c.android.versionCode||c.extra&&c.extra.versionCode||''")
VERSION=$(read_cfg "c.version||''")
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
# The API the bundle was built against is inlined at build time and cannot be
# changed afterwards, so it is recorded WITH the artefact. An APK pointing at
# the wrong host is indistinguishable from a broken server, and this is the
# only place that fact survives.
API_URL="$EXPO_PUBLIC_API_URL"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# NEVER GO BACKWARDS. The update check offers a build only when its versionCode
# is greater than the installed one, and Android refuses to install a lower one,
# so republishing an older or equal build would strand every tester on a build
# they cannot replace. Read what is live and refuse unless this is higher. No
# manifest yet (first publish) is fine; a manifest from before versionCodes
# existed has none, so any numbered build is higher than it.
CURRENT_MANIFEST=$(ssh "$HOST" "cat '$REMOTE_DIR/manifest.json' 2>/dev/null || true")
CURRENT_CODE=$(printf '%s' "$CURRENT_MANIFEST" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=Number(JSON.parse(s).versionCode);console.log(Number.isInteger(v)&&v>0?v:0)}catch{console.log(0)}})")
if [ "$VERSION_CODE" -le "$CURRENT_CODE" ]; then
  echo "Refusing to publish versionCode $VERSION_CODE: the server already has $CURRENT_CODE." >&2
  echo "A published build must be NEWER. Commit your work and rebuild, or set a higher SNAP_BUILD_NUMBER." >&2
  exit 1
fi

echo "publishing $(basename "$APK")"
echo "  version   $VERSION (versionCode $VERSION_CODE)"
echo "  commit    $COMMIT"
echo "  sha256    $SHA"
echo "  size      $SIZE bytes"
echo "  built for $API_URL"
echo "  to        $HOST:$REMOTE_DIR"

ssh "$HOST" "mkdir -p '$REMOTE_DIR'"

# APK first. `.part` then move, so a half-copied file is never the live one
# even for the instant before the manifest lands.
scp "$APK" "$HOST:$REMOTE_DIR/snap-apps-android.apk.part"
ssh "$HOST" "mv '$REMOTE_DIR/snap-apps-android.apk.part' '$REMOTE_DIR/snap-apps-android.apk'"

# Verify what arrived rather than assuming scp told the truth. A truncated
# upload that still gets a manifest is a download that installs and crashes.
REMOTE_SHA=$(ssh "$HOST" "sha256sum '$REMOTE_DIR/snap-apps-android.apk' | cut -d' ' -f1")
if [ "$REMOTE_SHA" != "$SHA" ]; then
  echo "checksum mismatch after upload: local $SHA, remote $REMOTE_SHA" >&2
  echo "the manifest was NOT written, so nothing is being advertised" >&2
  exit 1
fi

# Manifest second — this is what makes it visible.
ssh "$HOST" "cat > '$REMOTE_DIR/manifest.json'" <<JSON
{
  "version": "$VERSION",
  "versionCode": $VERSION_CODE,
  "buildNumber": "$COMMIT",
  "commit": "$COMMIT",
  "sha256": "$SHA",
  "byteSize": $SIZE,
  "publishedAt": "$NOW",
  "apiUrl": "$API_URL"
}
JSON

echo
echo "published. verify with:"
echo "  curl -s $API_URL/v1/downloads/android/manifest"
echo "  curl -sI $API_URL/v1/downloads/android/latest.apk"
