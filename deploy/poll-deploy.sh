#!/usr/bin/env bash
# Pull-based deploy: GitHub → this host → live.
#
# Run on a timer. Each tick asks what the deployable commit on `main` is, and
# if it differs from what is running, deploys it. Nobody SSHes in to ship.
#
# WHY PULL RATHER THAN PUSH. A push deploy needs a credential that can change
# this server, held by whatever is doing the pushing — a laptop, a CI runner.
# Pull inverts that: the server holds ONE read-only token and nothing outside
# needs access to it at all. It also means a deploy still happens when the
# person who merged has already closed their laptop.
#
# WHAT "DEPLOYABLE" MEANS HERE, and this is the important part: not "the newest
# commit on main". It is "the newest commit on main whose CI passed AND whose
# images were published". Deploying a commit whose tests failed is worse than
# not deploying, and deploying one whose images do not exist yet just fails
# noisily every minute until they do.
#
# Setup (once, as root) — ONE credential, nothing else:
#   1. Create a CLASSIC personal access token with scopes:
#        repo            (read the private repository)
#        read:packages   (pull the images from GHCR)
#      Classic, not fine-grained: GHCR's support for fine-grained tokens is
#      still partial, and a token that reads the repo fine but cannot pull an
#      image fails halfway through a deploy rather than at the first step.
#      It must belong to an account that can SEE the packages — they inherit
#      the repository's private visibility.
#      and put it in /etc/snap-apps/secrets/github.env as
#        GITHUB_TOKEN=github_pat_...
#      chmod 600 that file. It is the only secret this host needs.
#   2. systemctl enable --now snap-deploy.timer
#
# The same token authenticates git over HTTPS and `docker login ghcr.io`.
# A deploy key would be tidier for the git half, but deploy keys are DISABLED
# by policy on this repository — and one read-only token covering both is
# arguably better anyway: fewer credentials to rotate, and it cannot write.
#
# Logs: journalctl -u snap-deploy.service -f

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/snap-apps}"
REPO_SLUG="${REPO_SLUG:-gaiadabali/snap-app}"
BRANCH="${BRANCH:-main}"
# The two workflows that make a commit deployable, by FILE name. Each is asked
# about on its own (`/actions/workflows/<file>/runs`), never through the
# repo-wide run list. That list is shared with every other workflow, and the
# scheduled uptime monitor runs several times a day: from 2026-10-06 its runs
# alone filled the 20-run window this script used to read, so neither CI nor
# the images were visible and nothing deployed for two weeks — while the log
# blamed the token.
CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"
IMAGES_WORKFLOW="${IMAGES_WORKFLOW:-publish-images.yml}"
STATE_FILE="${STATE_FILE:-/var/lib/snap-apps/deployed-sha}"
SECRETS="${SECRETS:-/etc/snap-apps/secrets/github.env}"
LOCK="/var/lock/snap-deploy.lock"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
# To stderr, so a failure inside a command substitution still reaches the
# journal instead of being captured into a variable and lost.
fail() { log "FAILED: $*" >&2; exit 1; }

# `WORKFLOW` named the images workflow by its display name, and a drop-in on
# helios once pointed it at the uptime monitor. It is ignored now; say so,
# rather than let a stale override look as if it still steers anything.
if [[ -n "${WORKFLOW:-}" ]]; then
  log "note: WORKFLOW=${WORKFLOW} is ignored — set CI_WORKFLOW / IMAGES_WORKFLOW (workflow file names) instead"
fi

# One deploy at a time. A slow deploy overlapping the next tick would have two
# `docker compose up` runs racing over the same containers.
exec 9>"${LOCK}"
flock -n 9 || { log "another deploy is in progress; skipping this tick"; exit 0; }

[[ -f "${SECRETS}" ]] || fail "${SECRETS} not found — see the header of this script."
# shellcheck disable=SC1090
set -a; source "${SECRETS}"; set +a
[[ -n "${GITHUB_TOKEN:-}" ]] || fail "GITHUB_TOKEN not set in ${SECRETS}"

mkdir -p "$(dirname "${STATE_FILE}")"
DEPLOYED="$(cat "${STATE_FILE}" 2>/dev/null || echo none)"

api() {
  curl -sS --fail-with-body -m 30 \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# The fast path, and what makes a one-minute timer cheap. If the branch head
# is what is already running there is nothing newer to find, so the steady
# state costs ONE small API call a tick (~1,440 a day, against 5,000 an hour)
# and logs nothing. Only a head that differs pays for the run queries below.
HEAD_SHA="$(api "https://api.github.com/repos/${REPO_SLUG}/git/ref/heads/${BRANCH}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['object']['sha'])" 2>/dev/null || true)"
if [[ -n "${HEAD_SHA}" && "${HEAD_SHA:0:7}" == "${DEPLOYED}" ]]; then
  exit 0
fi

# The newest successful push runs of ONE workflow, newest first.
# Asking each workflow separately and intersecting is deliberate: a commit can
# have green images and red tests, and that must not deploy.
green_shas() {
  local file="$1" body
  body="$(api "https://api.github.com/repos/${REPO_SLUG}/actions/workflows/${file}/runs?branch=${BRANCH}&event=push&status=success&per_page=15")" \
    || fail "GitHub refused the ${file} runs query — is GITHUB_TOKEN valid, and can it read the repository?"
  python3 -c "
import json,sys
print('\n'.join(r['head_sha'] for r in json.load(sys.stdin).get('workflow_runs', [])))
" <<<"${body}"
}

log "Checking ${REPO_SLUG}@${BRANCH} (head ${HEAD_SHA:0:7}, currently deployed: ${DEPLOYED})"

CI_SHAS="$(green_shas "${CI_WORKFLOW}")"
IMG_SHAS="$(green_shas "${IMAGES_WORKFLOW}")"
# Empty is not an error any more: it means "nothing green yet", which is the
# normal state for the minute or two after a merge while the runs finish.
[[ -n "${CI_SHAS}" ]]  || { log "no successful ${CI_WORKFLOW} run on ${BRANCH} yet; nothing to do"; exit 0; }
[[ -n "${IMG_SHAS}" ]] || { log "no successful ${IMAGES_WORKFLOW} run on ${BRANCH} yet; nothing to do"; exit 0; }

# First SHA that appears in both lists, preserving CI's newest-first order.
TARGET=""
while read -r sha; do
  [[ -n "${sha}" ]] || continue
  if grep -qx "${sha}" <<<"${IMG_SHAS}"; then TARGET="${sha}"; break; fi
done <<<"${CI_SHAS}"

[[ -n "${TARGET}" ]] || { log "no commit has both CI and images green yet; nothing to do"; exit 0; }

SHORT="${TARGET:0:7}"
if [[ "${DEPLOYED}" == "${SHORT}" ]]; then
  log "already at ${SHORT}; nothing to do"
  exit 0
fi

# DRY_RUN=1 answers "what would this deploy?" without touching anything —
# how a change to this script gets tested on the host before a timer runs it.
if [[ "${DRY_RUN:-}" == "1" ]]; then
  log "DRY RUN: would deploy ${SHORT} (was ${DEPLOYED})"
  exit 0
fi

log "Deploying ${SHORT} (was ${DEPLOYED})"

# The working tree is needed for migrations and compose files, not for images.
# Fetched over HTTPS with the token supplied per-invocation rather than baked
# into the remote URL: a token written into .git/config leaks into every
# `git remote -v`, every backup of this directory, and any log that echoes it.
AUTH_HEADER="Authorization: Basic $(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 -w0)"
git -C "${REPO_DIR}" -c "http.https://github.com/.extraheader=${AUTH_HEADER}" fetch --quiet origin "${BRANCH}"
# Hard reset rather than merge: this checkout is a deployment artifact, not
# somewhere anyone edits, and a merge conflict at 3am helps nobody.
git -C "${REPO_DIR}" reset --quiet --hard "${TARGET}"

echo "${GITHUB_TOKEN}" | docker login ghcr.io -u "${GITHUB_ACTOR:-x-access-token}" --password-stdin >/dev/null 2>&1 \
  || fail "docker login to ghcr.io failed. Does the token have packages:read, and can that account see the package? GHCR packages inherit the private visibility of the repository."

# deploy.sh does the real work: migrate, roles, restart, and verify that
# /v1/ready reports rlsEnforced and that sign-in is 404. SKIP_CADDY because
# this host already terminates TLS for other sites on 80/443.
IMAGE_TAG="sha-${SHORT}" SKIP_CADDY="${SKIP_CADDY:-1}" "${REPO_DIR}/deploy/deploy.sh" --pull

echo "${SHORT}" > "${STATE_FILE}"
log "Deployed ${SHORT}"
