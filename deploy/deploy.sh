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
#   deploy/deploy.sh                 # build, migrate, verify, deploy at HEAD
#   deploy/deploy.sh --rollback SHA   # redeploy a previously-built image tag
#
# Does NOT: touch the postgres volume, run `db.mjs reset`, or force-recreate
# postgres. Any state-destroying operation is out of scope for this script by
# design — see the ticket this shipped under.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
COMPOSE=(docker compose -f "${HERE}/docker-compose.yml" --env-file "${HERE}/.env")
ENV_FILE="${HERE}/.env"

log()  { echo "==> $*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }

[[ -f "${ENV_FILE}" ]] || fail "deploy/.env not found. Copy deploy/.env.example and fill it in first."

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

ROLLBACK_SHA=""
if [[ "${1:-}" == "--rollback" ]]; then
  ROLLBACK_SHA="${2:?--rollback needs a SHA — see: docker images | grep snap-server}"
fi

cd "${REPO_ROOT}"

if [[ -n "${ROLLBACK_SHA}" ]]; then
  log "Rollback requested: redeploying image tag ${ROLLBACK_SHA} (no build, no migration)"
  docker image inspect "snap-server:${ROLLBACK_SHA}" >/dev/null 2>&1 || fail "no local image snap-server:${ROLLBACK_SHA} — it must have been built by a previous deploy.sh run on this host"
  docker image inspect "snap-web:${ROLLBACK_SHA}" >/dev/null 2>&1 || fail "no local image snap-web:${ROLLBACK_SHA}"
  IMAGE_TAG="${ROLLBACK_SHA}"
  export IMAGE_TAG
  "${COMPOSE[@]}" up -d postgres api worker web caddy
  log "Rolled back to ${ROLLBACK_SHA}. Verifying..."
else
  IMAGE_TAG="$(git rev-parse --short HEAD)"
  export IMAGE_TAG
  log "Building images at ${IMAGE_TAG}"
  "${COMPOSE[@]}" build --pull api worker web

  log "Pulling postgres/caddy"
  "${COMPOSE[@]}" pull postgres caddy

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

  log "Starting api, worker, web, caddy at image tag ${IMAGE_TAG}"
  "${COMPOSE[@]}" up -d api worker web caddy

  # Record the tag that just went live so a later --rollback has something to
  # target without the operator hunting through `docker images` or shell history.
  if grep -q '^IMAGE_TAG=' "${ENV_FILE}"; then
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
  else
    echo "IMAGE_TAG=${IMAGE_TAG}" >> "${ENV_FILE}"
  fi
fi

log "Waiting for containers to report healthy"
for svc in postgres api worker web caddy; do
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
SIGNIN_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' -X POST "${API_BASE}/v1/auth/sign-in" -H 'Content-Type: application/json' -d '{}')" || true
[[ "${SIGNIN_STATUS}" == "404" ]] \
  || fail "POST ${API_BASE}/v1/auth/sign-in returned ${SIGNIN_STATUS}, not 404 — this endpoint must never be reachable in production (see docs/DEPLOY.md §3). Refusing to consider this deploy successful."
log "sign-in correctly 404"

log "Deploy verified. Live at image tag ${IMAGE_TAG}."
echo
echo "Rollback if needed:  deploy/deploy.sh --rollback <previous-sha>"
echo "Logs:                docker compose -f deploy/docker-compose.yml logs -f <service>"
