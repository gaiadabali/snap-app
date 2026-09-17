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
REMOTE_STORAGE="${SNAP_STORAGE_HOST_DIR:-/srv/snap/storage}"
REMOTE_DIR="${REMOTE_STORAGE}/downloads/android"

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "usage: deploy/publish-apk.sh <path-to-apk> [commit-sha]" >&2
  exit 2
fi
if [ -z "$HOST" ]; then
  echo "SNAP_DEPLOY_HOST is not set (e.g. SNAP_DEPLOY_HOST=deploy@delphi)" >&2
  exit 2
fi

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c%s "$APK")
VERSION=$(node -p "require('./apps/mobile/app.json').expo.version" 2>/dev/null || echo 0.0.0)
# The API the bundle was built against is inlined at build time and cannot be
# changed afterwards, so it is recorded WITH the artefact. An APK pointing at
# the wrong host is indistinguishable from a broken server, and this is the
# only place that fact survives.
API_URL="${EXPO_PUBLIC_API_URL:-https://snap-apps-api.gaiada.com}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "publishing $(basename "$APK")"
echo "  version   $VERSION"
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
