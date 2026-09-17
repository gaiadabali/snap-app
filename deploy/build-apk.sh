#!/usr/bin/env bash
# Build a release APK that actually points at a server and knows what it is.
#
#   deploy/build-apk.sh [api-url]
#
# Run from a Linux environment with the Android SDK — on Windows that means
# WSL, because the native builds for react-native-screens and
# react-native-worklets deadlock under Windows' path handling: ninja loops on
# "Re-running CMake..." forever and never links.
#
# THE TWO VARIABLES THIS EXISTS TO SET. Both are inlined into the JS bundle at
# build time and cannot be changed afterwards, and forgetting either produces
# an APK that looks completely normal and is quietly wrong:
#
#   EXPO_PUBLIC_API_URL      Without it `api()` falls back to the FIXTURE
#                            implementation. One such build was installed on a
#                            handset and caught only because somebody noticed a
#                            "Demo" chip on the home screen.
#
#   EXPO_PUBLIC_BUILD_COMMIT Without it the in-app update check cannot tell
#                            whether it is stale — `expo.version` is 0.1.0 on
#                            every build ever made — so it declines to compare
#                            and nobody is ever offered an update.
#
# arm64-v8a only. Building all four ABIs in RelWithDebInfo drove the load
# average past 100 on an 8-core box for no benefit: every Android phone worth
# testing on is arm64, and armeabi-v7a is 32-bit hardware from before 2015. A
# full-fat multi-ABI build belongs in CI.
set -euo pipefail

API_URL="${1:-${EXPO_PUBLIC_API_URL:-https://snap-apps-api.gaiada.com}}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export EXPO_PUBLIC_API_URL="$API_URL"
export EXPO_PUBLIC_BUILD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
export EXPO_PUBLIC_BUILD_VERSION="$(node -p "require('$REPO_ROOT/apps/mobile/app.json').expo.version")"

echo "building $EXPO_PUBLIC_BUILD_VERSION / $EXPO_PUBLIC_BUILD_COMMIT"
echo "  against $EXPO_PUBLIC_API_URL"

# Refuse to build from a dirty tree. The commit inlined above is what the
# update check compares and what publish-apk.sh records in the manifest, so an
# APK built from uncommitted work would claim to be a commit it is not — and
# the next person to pull that commit would get a different app.
if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- apps/mobile packages 2>/dev/null)" ]; then
  echo >&2
  echo "Uncommitted changes under apps/mobile or packages/." >&2
  echo "The build stamps $EXPO_PUBLIC_BUILD_COMMIT into the bundle; building" >&2
  echo "from a dirty tree makes that stamp a lie. Commit or stash first." >&2
  exit 1
fi

cd "$REPO_ROOT/apps/mobile"
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease --console=plain \
  -PreactNativeArchitectures=arm64-v8a \
  --max-workers=4

APK="$REPO_ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
ls -la "$APK"
echo
echo "built. publish it with:"
echo "  EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL SNAP_DEPLOY_HOST=<user@host> \\"
echo "    deploy/publish-apk.sh $APK $EXPO_PUBLIC_BUILD_COMMIT"
