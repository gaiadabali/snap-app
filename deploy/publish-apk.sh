#!/usr/bin/env bash
# Put an Android build on the deploy host from a laptop, where the API serves it.
#
#   deploy/publish-apk.sh path/to/app-release.apk [commit-sha]
#
# THIS IS THE MANUAL PATH. The normal one needs no laptop: push an `android-v*`
# tag and CI builds the APK into a GitHub Release, which the host pulls itself
# (deploy/pull-apk.sh, from the poller). See docs/BUILD.md section 8. This script
# stays for when CI is down or a build must go out from a machine.
#
# WHY THE HOST AND NOT A COMMIT. The APK is ~50MB and is rebuilt several times a
# day during alpha. `apps/web/public` would put every one of those in git history
# permanently. The host already has a storage volume and already terminates TLS,
# so the artefact goes there and `ReleasesController` serves it from a stable URL.
#
# THE RULES ARE NOT HERE. What may go live (the bundle holds the API URL, the
# versionCode is embedded and ABOVE the live one, the newest release note is not
# already published) and how it goes live (the APK, then releases.json, then
# manifest.json, each atomic, the manifest LAST because it is what makes a build
# visible) are all in deploy/place-apk.sh, which runs ON THE HOST. The host's own
# poller runs the same script, so a laptop publish and a CI release obey one set
# of rules. This script ships place-apk.sh and release-notes.mjs from THIS
# checkout to a staging directory beside the live files, runs it there, and
# removes the staging directory. A refusal leaves the live files untouched.
#
# RELEASE NOTES ARE REQUIRED (task 1.12.d/j/k). The newest entry in
# apps/mobile/release-notes.json is what this build says about itself; it is
# refused when already attached to a published build, with the commit subjects
# since the last published build printed as a draft to rewrite. The rules are in
# deploy/release-notes.mjs.
#
# Requires: ssh access to the deploy host, and node, unzip and sha256sum on it.
# Set SNAP_DEPLOY_HOST, or pass it in the environment:
#
#   EXPO_PUBLIC_API_URL=https://... SNAP_DEPLOY_HOST=user@host deploy/publish-apk.sh app-release.apk
#
# DRY_RUN=1 uploads to staging, runs every check, and places nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so the logic can be run against a copy; the real path is the repo's.
NOTES_FILE="${SNAP_RELEASE_NOTES:-$SCRIPT_DIR/../apps/mobile/release-notes.json}"

APK="${1:-}"
COMMIT="${2:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
HOST="${SNAP_DEPLOY_HOST:-}"
# Must match STORAGE_HOST_DIR in deploy/docker-compose.yml: the same directory
# the API container sees as STORAGE_DIR. Verified against the host rather than
# guessed: deploy/.env sets STORAGE_HOST_DIR=/opt/snap-apps/data/storage. The
# first version of this script guessed /srv/snap/storage, which would have
# uploaded the APK into a directory nothing serves.
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
if [ ! -f "$NOTES_FILE" ]; then
  echo "release notes not found: $NOTES_FILE" >&2
  exit 2
fi

# `EXPO_PUBLIC_API_URL` is inlined into the JS bundle at build time; unset, the
# app runs on FIXTURES. It names the API the bundle must have been built against,
# and place-apk.sh greps the bundle for it on the host. The environment variable
# says what SHOULD have happened; the bundle says what DID.
if [ -z "${EXPO_PUBLIC_API_URL:-}" ]; then
  echo "EXPO_PUBLIC_API_URL is not set — refusing to publish." >&2
  echo "Without it the bundle runs on fixtures and never contacts the server." >&2
  exit 2
fi
API_URL="$EXPO_PUBLIC_API_URL"

# A fresh staging directory inside the live one: same filesystem, hidden, and
# never served (the API serves fixed file names). Removed on the way out.
STAGE=$(ssh "$HOST" "mkdir -p '$REMOTE_DIR' && mktemp -d '$REMOTE_DIR/.incoming.XXXXXX'")
case "$STAGE" in
  "$REMOTE_DIR"/.incoming.*) ;;
  *) echo "could not create a staging directory on $HOST (got '$STAGE')" >&2; exit 1 ;;
esac
cleanup() { ssh "$HOST" "rm -rf '$STAGE'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "uploading $(basename "$APK") to $HOST:$STAGE"
scp "$APK" "$HOST:$STAGE/app.apk"
scp "$NOTES_FILE" "$HOST:$STAGE/release-notes.json"
scp "$SCRIPT_DIR/place-apk.sh" "$SCRIPT_DIR/release-notes.mjs" "$HOST:$STAGE/"

# printf %q so a value with spaces or quotes cannot break out of the command.
# DRY_RUN is passed through: every check runs and nothing is placed.
if ! ssh "$HOST" "DRY_RUN='${DRY_RUN:-}' bash '$STAGE/place-apk.sh' \
    --apk '$STAGE/app.apk' --notes '$STAGE/release-notes.json' \
    --commit $(printf %q "$COMMIT") --api-url $(printf %q "$API_URL") --dir '$REMOTE_DIR'"; then
  echo "Refused or failed on the host. Nothing was published." >&2
  exit 1
fi

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "dry run: every check passed; nothing was placed."
  exit 0
fi

echo
echo "published. verify with:"
echo "  curl -s $API_URL/v1/downloads/android/manifest"
echo "  curl -s $API_URL/v1/downloads/android/releases"
echo "  curl -sI $API_URL/v1/downloads/android/latest.apk"
