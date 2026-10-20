#!/usr/bin/env bash
# Pull-based Android release: GitHub Release -> this host -> live.
#
#   deploy/pull-apk.sh            (called from poll-deploy.sh every tick; also runnable by hand)
#
# CI builds the APK when someone pushes an `android-v*` tag and attaches it to a
# GitHub Release (.github/workflows/android-release.yml). This script is the
# other half: it looks at the newest such release and, when it is a build the
# host has not served yet, downloads it and places it where the API serves it.
#
# WHY PULL. The same reasoning as poll-deploy.sh. A push needs a credential that
# can change this server, held by whatever pushes: a CI runner or a laptop. Pull
# inverts it. CI holds nothing but the repository's own token, with no way to
# reach the host, and the host reads a PUBLIC release, so it needs no secret
# either. (It uses GITHUB_TOKEN from github.env when there is one, only to get a
# higher API rate limit.)
#
# WHAT IT DOES, in order. Every step is cheap until the last:
#   1. Ask GitHub for the release list, with the last ETag. Nothing changed is a
#      304, which costs no rate limit: the steady state is one free call a tick.
#   2. Pick the newest PUBLISHED `android-v*` release. Drafts and prereleases are
#      never acted on: a draft is unfinished by definition, and a prerelease is
#      how a person marks "not for testers yet". Releases missing any asset are
#      skipped too (CI uploads the three in one command, but be safe).
#   3. Download build.json (a few hundred bytes). Not above the manifest's
#      versionCode? Done, and quietly: the host never goes backwards.
#   4. Download the APK and its .sha256. Refuse unless the file's sha256 equals
#      both the .sha256 and build.json's.
#   5. Run deploy/place-apk.sh, THE SAME script a laptop publish runs, which
#      checks the APK's embedded versionCode and API URL, applies the release-
#      notes rule (the entry in build.json is the one this build carries) and
#      writes the APK, then releases.json, then manifest.json, each atomically.
#
# It also refuses a release whose API URL is not EXPECTED_API_URL: an APK built
# against another server (a workflow_dispatch input, say) must not reach testers.
#
# RESUMING. Nothing is remembered between runs except the ETag, and that is
# saved only once a release has been dealt with: placed, not newer, or refused
# for good. A download that failed, a sha that did not match, a placement that
# died halfway: no ETag is saved, so the next tick tries the whole thing again,
# and place-apk.sh resumes a build whose releases.json entry already landed.
# To force a re-check, delete $STATE_DIR/apk-releases.etag.
#
# DRY_RUN=1 does everything up to and including every check, then places nothing
# and saves nothing.
#
# Exit: 0 nothing to do or placed; 1 a release was refused (logged once, then
# the ETag makes later ticks silent); 2 could not complete, will retry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/opt/snap-apps}"
REPO_SLUG="${REPO_SLUG:-gaiadabali/snap-app}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
STATE_DIR="${STATE_DIR:-/var/lib/snap-apps}"
SECRETS="${SECRETS:-/etc/snap-apps/secrets/github.env}"
EXPECTED_API_URL="${EXPECTED_API_URL:-https://snap-apps-api.gaiada.com}"
DRY_RUN="${DRY_RUN:-}"

# Where the API serves from: the same directory place-apk.sh writes, which is
# <STORAGE_HOST_DIR>/downloads/android. STORAGE_HOST_DIR is in deploy/.env.
if [ -z "${STORAGE_HOST_DIR:-}" ] && [ -f "$REPO_DIR/deploy/.env" ]; then
  STORAGE_HOST_DIR="$(grep -E '^STORAGE_HOST_DIR=' "$REPO_DIR/deploy/.env" | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
fi
STORAGE_HOST_DIR="${STORAGE_HOST_DIR:-/opt/snap-apps/data/storage}"
DEST_DIR="$STORAGE_HOST_DIR/downloads/android"

ETAG_FILE="$STATE_DIR/apk-releases.etag"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] pull-apk: $*"; }
# stderr, so a failure inside a command substitution still reaches the journal.
fail() { log "FAILED: $*" >&2; exit 2; }

for tool in curl node sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done

# The token is optional: a public repo's release needs none.
if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$SECRETS" ]; then
  # shellcheck disable=SC1090
  set -a; source "$SECRETS"; set +a
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

conclude() {
  # The release list we just read has been dealt with: remember its ETag so the
  # next tick's request is a free 304. Never in a dry run.
  if [ "$DRY_RUN" != "1" ] && [ -f "$WORK/headers" ]; then
    local etag
    etag="$(grep -i '^etag:' "$WORK/headers" | tail -n1 | sed 's/^[^:]*: *//' | tr -d '\r' || true)"
    if [ -n "$etag" ]; then
      mkdir -p "$STATE_DIR"
      printf '%s\n' "$etag" > "$ETAG_FILE"
    fi
  fi
}

# 1. The release list, conditional on the last ETag.
CURL_AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
CURL_COND=()
if [ -f "$ETAG_FILE" ] && [ -s "$ETAG_FILE" ]; then
  CURL_COND=(-H "If-None-Match: $(cat "$ETAG_FILE")")
fi
STATUS="$(curl -sS -m 30 -o "$WORK/releases.json" -D "$WORK/headers" -w '%{http_code}' \
  -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
  ${CURL_AUTH[@]+"${CURL_AUTH[@]}"} ${CURL_COND[@]+"${CURL_COND[@]}"} \
  "$GITHUB_API/repos/$REPO_SLUG/releases?per_page=10")" \
  || fail "could not reach GitHub"
case "$STATUS" in
  304) exit 0 ;;
  200) ;;
  *) fail "GitHub answered $STATUS to the releases query" ;;
esac

# 2. The newest published android-v* release.
PICKED="$(node "$SCRIPT_DIR/apk-release.mjs" pick-release "$WORK/releases.json")" \
  || fail "could not read the release list"
if [ -z "$PICKED" ]; then
  conclude
  exit 0
fi
{ read -r TAG; read -r URL_BUILD; read -r URL_APK; read -r URL_SHA; } < <(node -e "
const p=JSON.parse(process.argv[1]);
console.log([p.tag,p.assets.build,p.assets.apk,p.assets.sha256].join('\n'))" "$PICKED")

# 3. build.json, and the cheap "is it newer" test.
download() { curl -sSL --fail -m 180 -o "$2" "$1" || fail "could not download $1"; }
download "$URL_BUILD" "$WORK/build.json"
if ! node "$SCRIPT_DIR/apk-release.mjs" check-build "$WORK/build.json" 2>"$WORK/problems"; then
  log "REFUSED $TAG: $(tr '\n' ' ' < "$WORK/problems")" >&2
  conclude
  exit 1
fi
{ read -r B_CODE; read -r B_VERSION; read -r B_TAG; read -r B_COMMIT; read -r B_API; read -r B_SHA; } < <(node -e "
const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
console.log([b.versionCode,b.version,b.tag,b.commit,b.apiUrl,b.sha256].join('\n'))" "$WORK/build.json")

LOCAL_CODE="$(node -e "
try{const v=Number(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).versionCode);console.log(Number.isInteger(v)&&v>0?v:0)}catch{console.log(0)}" "$DEST_DIR/manifest.json")"
if [ "$B_CODE" -le "$LOCAL_CODE" ]; then
  # Equal is "already placed"; lower is an older release. Both: nothing to do.
  conclude
  exit 0
fi

# Everything below acts, so each refusal is logged and is permanent for this release.
refuse() { log "REFUSED $TAG: $*" >&2; conclude; exit 1; }
[ "$B_TAG" = "$TAG" ] || refuse "build.json says tag $B_TAG"
[ "$B_API" = "$EXPECTED_API_URL" ] || refuse "built for $B_API, but this host serves $EXPECTED_API_URL"

log "$TAG is versionCode $B_CODE, the host serves $LOCAL_CODE"

# 4. The APK, and its checksum, two ways.
download "$URL_APK" "$WORK/app.apk"
download "$URL_SHA" "$WORK/app.apk.sha256"
ACTUAL_SHA="$(sha256sum "$WORK/app.apk" | cut -d' ' -f1)"
FILE_SHA="$(awk '{print tolower($1); exit}' "$WORK/app.apk.sha256")"
# A sha mismatch is a bad or tampered download, not a verdict on the release:
# no ETag, so the next tick downloads it again.
if [ "$ACTUAL_SHA" != "$B_SHA" ] || [ "$ACTUAL_SHA" != "$FILE_SHA" ]; then
  fail "checksum mismatch for $TAG: file $ACTUAL_SHA, build.json $B_SHA, .sha256 $FILE_SHA; not placing"
fi

# 5. Place it, by the same rules a laptop publish obeys. The notes list holds the
# one entry this build carries (the newest in the repo at the tag).
node -e "
const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
require('fs').writeFileSync(process.argv[2], JSON.stringify([b.entry],null,2)+'\n');" "$WORK/build.json" "$WORK/notes.json"

set +e
DRY_RUN="$DRY_RUN" bash "$SCRIPT_DIR/place-apk.sh" \
  --apk "$WORK/app.apk" --notes "$WORK/notes.json" \
  --commit "$B_COMMIT" --api-url "$B_API" --dir "$DEST_DIR" \
  --expect-version-code "$B_CODE" --expect-version "$B_VERSION"
RC=$?
set -e
case "$RC" in
  0) ;;
  1) refuse "place-apk.sh refused it (see above)" ;;
  *) fail "place-apk.sh could not complete (exit $RC); will retry" ;;
esac

if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN: would have placed $TAG (versionCode $B_CODE); nothing was written"
  exit 0
fi
conclude
log "placed $TAG (versionCode $B_CODE, was $LOCAL_CODE)"
