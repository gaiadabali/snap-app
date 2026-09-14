#!/usr/bin/env bash
# Snap Apps — idempotent deploy/rollout.
#
# Encodes docs/DEPLOY.md §7's pre-deploy checklist as executable steps rather
# than restating it as prose. Safe to re-run: migrations are individually
# transactional and recorded in `_migrations` (packages/db/scripts/db.mjs),
# `appuser` is CREATE-OR-ALTER, and `docker compose up -d` only recreates
# containers whose config actually changed.
#
# Usage (as the snapapps user, from the repo root, after bootstrap.sh and a
# filled-in deploy/.env):
#   deploy/deploy.sh                 # build on this host, migrate, verify, deploy
#   deploy/deploy.sh --pull           # PULL prebuilt images from GHCR instead
#   deploy/deploy.sh --rollback SHA   # redeploy a previously-deployed image tag
#
# SKIP_CADDY=1 deploy/deploy.sh ...  # host already has a reverse proxy on 80/443
#
# Set SKIP_CADDY=1 when something else already owns 80/443 — an existing nginx
# serving other sites, for instance. Caddy would fail to bind and, worse, a
# careless fix would take that other thing down. With it set, api and web are
# published on loopback only and you point the existing proxy at them; see
# docs/DEPLOY.md §9.
#
# Prefer --pull on a small VPS. `next build` is the most memory-hungry step in
# this stack and is the one that gets OOM-killed on a 2 GB box, with an error
# that reads like a code fault rather than a capacity one. The images are built
# by .github/workflows/publish-images.yml, so --pull also means the artifact
# that CI tested is the artifact that runs.
# Requires SERVER_IMAGE / WEB_IMAGE / IMAGE_TAG in deploy/.env, and a prior
# `docker login ghcr.io` (the repo is private).
#
# Does NOT: touch the postgres volume, run `db.mjs reset`, or force-recreate
# postgres. Any state-destroying operation is out of scope for this script by
# design — see the ticket this shipped under.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
COMPOSE=(docker compose -f "${HERE}/docker-compose.yml" --env-file "${HERE}/.env")

# Which services this host runs. Caddy is optional because a box that already
# terminates TLS for other sites must not have a second thing fighting for
# port 443.
SERVICES=(api worker web mobile caddy)
HEALTH_SERVICES=(postgres api worker web mobile caddy)
if [[ "${SKIP_CADDY:-0}" == "1" ]]; then
  SERVICES=(api worker web mobile)
  HEALTH_SERVICES=(postgres api worker web mobile)
fi
ENV_FILE="${HERE}/.env"

log()  { echo "==> $*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }

[[ -f "${ENV_FILE}" ]] || fail "deploy/.env not found. Copy deploy/.env.example and fill it in first."

# An IMAGE_TAG passed by the CALLER must survive sourcing the env file.
#
# `set -a; source` overwrites the environment with whatever the file says, and
# deploy.sh WRITES the last deployed tag back into that file at the end. So the
# poller's `IMAGE_TAG=sha-abc1234 deploy.sh --pull` was being silently replaced
# by the previous run's value, and the deploy would pull a tag nobody asked for
# — or one that does not exist, failing with a registry error that says nothing
# about precedence.
CALLER_IMAGE_TAG="${IMAGE_TAG:-}"

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

if [[ -n "${CALLER_IMAGE_TAG}" ]]; then
  IMAGE_TAG="${CALLER_IMAGE_TAG}"
  export IMAGE_TAG
fi

ROLLBACK_SHA=""
PULL_MODE=0
case "${1:-}" in
  --rollback) ROLLBACK_SHA="${2:?--rollback needs a SHA — see: docker images | grep snap-server}" ;;
  --pull)     PULL_MODE=1 ;;
  "")         ;;
  *)          fail "unknown option '${1}'. Use --pull, --rollback SHA, or no argument." ;;
esac

if [[ "${PULL_MODE}" == "1" ]]; then
  # Named explicitly rather than defaulted: pulling the wrong registry's image
  # is a silent way to deploy something nobody reviewed.
  [[ -n "${SERVER_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]     || fail "--pull needs SERVER_IMAGE and WEB_IMAGE in deploy/.env (e.g. ghcr.io/gaiadabali/snap-server)."
  [[ -n "${IMAGE_TAG:-}" ]]     || fail "--pull needs IMAGE_TAG in deploy/.env naming an exact build (e.g. sha-1a2b3c4). Never 'latest' — a rollback must be able to name what it is rolling back to."
fi

cd "${REPO_ROOT}"

if [[ -n "${ROLLBACK_SHA}" ]]; then
  log "Rollback requested: redeploying image tag ${ROLLBACK_SHA} (no build, no migration)"
  docker image inspect "snap-server:${ROLLBACK_SHA}" >/dev/null 2>&1 || fail "no local image snap-server:${ROLLBACK_SHA} — it must have been built by a previous deploy.sh run on this host"
  docker image inspect "snap-web:${ROLLBACK_SHA}" >/dev/null 2>&1 || fail "no local image snap-web:${ROLLBACK_SHA}"
  IMAGE_TAG="${ROLLBACK_SHA}"
  export IMAGE_TAG
  "${COMPOSE[@]}" up -d postgres "${SERVICES[@]}"
  log "Rolled back to ${ROLLBACK_SHA}. Verifying..."
else
  if [[ "${PULL_MODE}" == "1" ]]; then
    export IMAGE_TAG
    log "Pulling prebuilt images ${SERVER_IMAGE}:${IMAGE_TAG} and ${WEB_IMAGE}:${IMAGE_TAG}"
    "${COMPOSE[@]}" pull api worker web       || fail "pull failed. The repo is private — has this host run 'docker login ghcr.io'? Does the tag exist?"
  else
    IMAGE_TAG="$(git rev-parse --short HEAD)"
    export IMAGE_TAG
    log "Building images at ${IMAGE_TAG} (use --pull on a small VPS; next build is memory-hungry)"
    "${COMPOSE[@]}" build --pull api worker web
  fi

  log "Pulling postgres/caddy"
  if [[ "${SKIP_CADDY:-0}" == "1" ]]; then "${COMPOSE[@]}" pull postgres; else "${COMPOSE[@]}" pull postgres caddy; fi

  log "Starting postgres, waiting for it to be genuinely ready"
  "${COMPOSE[@]}" up -d postgres
  tries=0
  until "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d snapapps >/dev/null 2>&1; do
    tries=$((tries + 1))
    [[ "${tries}" -lt 60 ]] || fail "postgres did not become ready within 60s"
    sleep 1
  done

  log "Applying migrations (packages/db/scripts/db.mjs migrate)"
  SNAP_PG_CONTAINER="${SNAP_PG_CONTAINER:-snap-postgres}" \
    node "${REPO_ROOT}/packages/db/scripts/db.mjs" migrate

  log "Ensuring snap_app / snap_worker roles exist (packages/db/scripts/db.mjs appuser)"
  SNAP_PG_CONTAINER="${SNAP_PG_CONTAINER:-snap-postgres}" \
  APP_DB_PASSWORD="${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set in deploy/.env}" \
    node "${REPO_ROOT}/packages/db/scripts/db.mjs" appuser

  log "Starting ${SERVICES[*]} at image tag ${IMAGE_TAG}"
  "${COMPOSE[@]}" up -d "${SERVICES[@]}"

  # Record the tag that just went live so a later --rollback has something to
  # target without the operator hunting through `docker images` or shell history.
  if grep -q '^IMAGE_TAG=' "${ENV_FILE}"; then
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
  else
    echo "IMAGE_TAG=${IMAGE_TAG}" >> "${ENV_FILE}"
  fi
fi

log "Waiting for containers to report healthy"
for svc in "${HEALTH_SERVICES[@]}"; do
  tries=0
  until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q "${svc}")" 2>/dev/null)" == "healthy" ]]; do
    tries=$((tries + 1))
    [[ "${tries}" -lt 60 ]] || fail "${svc} did not become healthy within 60s — check: docker compose -f deploy/docker-compose.yml logs ${svc}"
    sleep 2
  done
  log "${svc}: healthy"
done

# ── The two checks docs/DEPLOY.md §7 says are worth doing by hand ──────────
API_BASE="${PUBLIC_URL:?PUBLIC_URL must be set in deploy/.env}"

log "Verify: GET \${PUBLIC_URL}/v1/ready reports rlsEnforced: true"
READY_BODY="$(curl -fsS "${API_BASE}/v1/ready")" || fail "GET ${API_BASE}/v1/ready did not respond"
echo "    ${READY_BODY}"
echo "${READY_BODY}" | grep -q '"rlsEnforced":true' \
  || fail "/v1/ready did NOT report rlsEnforced:true — the API may be connected as a role that bypasses RLS. DO NOT consider this deploy complete. Response: ${READY_BODY}"

log "Verify: POST \${PUBLIC_URL}/v1/auth/sign-in returns 404 (it must be 404 in production, never 200)"
# A VALID body, deliberately. `{}` fails the email validator and returns 400
# before the request reaches the handler — so the old check could not tell
# "the production gate is present" from "the gate was deleted". It was
# verifying the validation pipe, not the security control it claimed to.
# A well-formed address reaches the handler, where the gate decides.
SIGNIN_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_BASE}/v1/auth/sign-in" -H 'Content-Type: application/json' -d '{"email":"deploy-probe@invalid.example"}')" || true
[[ "${SIGNIN_STATUS}" == "404" ]] \
  || fail "POST ${API_BASE}/v1/auth/sign-in returned ${SIGNIN_STATUS}, not 404 — this endpoint must never be reachable in production (see docs/DEPLOY.md §3). Refusing to consider this deploy successful."
log "sign-in correctly 404"

log "Deploy verified. Live at image tag ${IMAGE_TAG}."
echo
echo "Rollback if needed:  deploy/deploy.sh --rollback <previous-sha>"
echo "Logs:                docker compose -f deploy/docker-compose.yml logs -f <service>"
