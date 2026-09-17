# Snap Apps server image — API and worker share this image; they differ only
# in the command (`serve` vs `worker`, see deploy/docker-compose.yml).
#
# Runs under `tsx`, deliberately NOT `node dist/main.js`. `@snap/tax-engine`
# (and `@snap/api-contract`) use extensionless relative imports that need a
# bundler-style resolver — that is why the server's own `serve`/`worker`
# scripts are `tsx scripts/*.ts` rather than a `tsc` build (see
# apps/server/package.json and docs/PLAN.md §6.1). This image reproduces that
# exact invocation rather than inventing a `tsc` build that has never been
# verified to work.
#
# Build context MUST be the repo root (this is a pnpm workspace):
#   docker build -f apps/server/Dockerfile -t snap-server:TAG .
#
# Node 22, not 20: the root package.json's `engines.node` says ">=20", but
# pnpm@11.3.0 (pinned by packageManager) refuses to run under anything older
# than 22.13 ("This version of pnpm requires at least Node.js v22.13") —
# verified locally rather than assumed from the engines field, which is
# stale here.

FROM node:22.14.0-bookworm-slim AS base
# `corepack prepare` verifies pnpm's publish signature against a key list
# baked into corepack itself; the copy shipped with this node image predates
# pnpm 11's signing key and fails closed with "Cannot find matching keyid"
# rather than silently skipping the check. Installing pnpm directly via npm
# avoids that keyid gap and still pins the exact version.
RUN npm install -g pnpm@11.3.0
# procps: gives the worker container a `pgrep`-based healthcheck without
# pulling in a whole init system.
RUN apt-get update && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ── deps: install only what @snap/server needs, workspace-aware ────────────
# Manifests are copied individually (not `COPY . .`) so this layer only
# invalidates when a package.json or the lockfile changes, not on every source
# edit. Every workspace package.json must be present for pnpm to resolve the
# workspace graph, even ones this image never runs (apps/mobile, apps/web) —
# pnpm-workspace.yaml's globs are checked against the filesystem, not only the
# lockfile, and a missing importer breaks a frozen-lockfile install.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/docai/package.json packages/docai/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json
COPY packages/tax-rules/package.json packages/tax-rules/package.json
COPY packages/docai-preview/package.json packages/docai-preview/package.json
# --filter "@snap/server..." installs @snap/server and everything it depends
# on (workspace + registry), and nothing apps/mobile or apps/web only need —
# so this never fetches Expo/React Native toolchains into a server image.
RUN pnpm install --frozen-lockfile --filter "@snap/server..."

# ── runtime ──────────────────────────────────────────────────────────────────
FROM deps AS runtime
ENV NODE_ENV=production
# Source for @snap/server and every workspace package it imports at runtime
# (tsx resolves these live — nothing here is pre-bundled).
COPY packages/api-contract packages/api-contract
COPY packages/db packages/db
COPY packages/docai packages/docai
COPY packages/tax-engine packages/tax-engine
# Every workspace package apps/server DEPENDS ON must be here.
#
# These two were missing and the omission was invisible until it wasn't:
# `@snap/tax-rules` shipped, the container imported `formatLocalAmount` from a
# package that was not in the image, and the API served 502 until this line
# existed. The image BUILT fine — nothing checks at build time that a declared
# workspace dependency was copied — so CI was green and production was down.
#
# If you add a `@snap/*` dependency to apps/server/package.json, add it here in
# BOTH places: the manifest block above (for the install layer) and here.
COPY packages/tax-rules packages/tax-rules
COPY packages/docai-preview packages/docai-preview
COPY apps/server apps/server

# Plain (non --system) group/user at a fixed high uid/gid: --system forces
# useradd to hunt for a free id inside the (much smaller) system range even
# though one is given explicitly, which is needlessly slow in a container.
RUN groupadd --gid 1001 snap \
    && useradd --uid 1001 --gid 1001 --no-create-home snap \
    && mkdir -p /data/storage \
    && chown -R snap:snap /repo /data/storage

USER snap
WORKDIR /repo/apps/server
EXPOSE 4000

# `pnpm serve` / `pnpm worker` run the scripts declared in
# apps/server/package.json from this working directory — the exact commands
# docs/DEPLOY.md and local dev already use.
ENTRYPOINT ["pnpm"]
CMD ["serve"]
