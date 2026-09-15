# Snap Apps web image — Next.js as a Node server (`next start`), NOT a static
# export: server components, middleware, and httpOnly-cookie auth all need a
# running server (see next.config.ts, apps/web/src/lib/config.ts).
#
# Build context MUST be the repo root (this is a pnpm workspace):
#   docker build -f apps/web/Dockerfile -t snap-web:TAG .
#
# No secrets are needed at build time: apps/web/src/lib/config.ts reads
# GOOGLE_CLIENT_ID/SECRET and SNAP_API_URL lazily via process.env at request
# time, not at build time, and nothing in this repo bakes NEXT_PUBLIC_* values
# in (there are none) — so the same image is deployed unchanged across
# environments and configured only via the container's environment.

# Node 22, not 20 — see apps/server/Dockerfile: pnpm@11.3.0 requires >=22.13,
# which the root package.json's engines field does not reflect.
FROM node:22.14.0-bookworm-slim AS base
# See apps/server/Dockerfile for why this installs pnpm via npm rather than
# `corepack prepare` (a signing-key mismatch in the node image's bundled
# corepack).
RUN npm install -g pnpm@11.3.0
WORKDIR /repo

# ── deps: full graph for @snap/web, including devDependencies (`next build`
# needs typescript/tailwind) ─────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/docai/package.json packages/docai/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json
RUN pnpm install --frozen-lockfile --filter "@snap/web..."

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/api-contract packages/api-contract
COPY apps/web apps/web
# `outputFileTracingRoot` in next.config.ts points at the repo root, so the
# workspace layout has to match what it will be at runtime.
WORKDIR /repo/apps/web
# `COPY --from=build .../public` must never fail on an absent source. It does
# exist now (the marketing app screenshots live in public/screens), but this
# stays so a checkout without it still builds.
RUN mkdir -p public

# ── Sample testimonials: review hosts only ───────────────────────────────────
# `next build` sets NODE_ENV=production, which trips the guard in
# src/app/(marketing)/_components/proof-data.ts while the proof section still
# holds SAMPLE testimonials. That guard is deliberate — see docs/WEB.md §4.5.
#
# Defaults to EMPTY, so a plain `docker build` of this file still refuses to
# produce an image advertising customers we do not have. The review host opts
# in explicitly via build-args in .github/workflows/publish-images.yml.
#
# REMOVE the ARG here and the build-arg there together, the moment the proof
# section carries real consented quotes.
ARG SNAP_ALLOW_PLACEHOLDER_PROOF=""
ENV SNAP_ALLOW_PLACEHOLDER_PROOF=$SNAP_ALLOW_PLACEHOLDER_PROOF

RUN pnpm build

# ── runtime ──────────────────────────────────────────────────────────────────
# A slim runtime, NOT the build stage.
#
# This used to be `FROM build`, carrying node_modules and the build cache into
# the shipped image: 2.72 GB. The stated reason was real — `next start` loads
# next.config.ts, which is TypeScript, so it needs the `typescript`
# devDependency at process start. `output: 'standalone'` removes that reason
# entirely: `.next/standalone/server.js` is plain JavaScript, never reads the
# config, and carries only the dependencies Next actually traced.
#
# It matters beyond tidiness: the target VPS is at 85% disk and serves live
# sites, so a multi-gigabyte image is a real risk to somebody else's uptime.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production     PORT=3000     HOSTNAME=0.0.0.0

WORKDIR /repo

# Plain (non --system) ids, matching apps/server/Dockerfile.
RUN groupadd --gid 1001 snap     && useradd --uid 1001 --gid 1001 --no-create-home snap

# `outputFileTracingRoot` is the repo root, so standalone reproduces the
# workspace layout: server.js sits at apps/web/ with node_modules at the root.
COPY --from=build --chown=snap:snap /repo/apps/web/.next/standalone ./
# Static assets and public/ are deliberately NOT included in standalone output
# — Next expects them copied alongside, and without this every asset 404s
# while the pages themselves render, which looks like a CSS bug.
COPY --from=build --chown=snap:snap /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=snap:snap /repo/apps/web/public ./apps/web/public

USER snap
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
