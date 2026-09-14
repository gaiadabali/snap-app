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
# apps/web has no public/ directory today; make sure it exists so the later
# `COPY --from=build .../public` never fails on an absent source.
RUN mkdir -p public
RUN pnpm build

# ── runtime ──────────────────────────────────────────────────────────────────
# Reuses the `build` stage's node_modules wholesale rather than a fresh
# `--prod` install. Verified necessary, not assumed: next.config.ts is
# TypeScript, and `next start` loads it by invoking the TypeScript compiler
# ON DEMAND at process start — a `--prod` install strips the `typescript`
# devDependency, and `next start` then fails outright trying (and failing) to
# self-install it, tripping over pnpm's store-location check in the process.
FROM build AS runtime
ENV NODE_ENV=production

# See apps/server/Dockerfile — plain (non --system) ids to avoid useradd
# scanning the system-id range for a slot it will not use.
RUN groupadd --gid 1001 snap \
    && useradd --uid 1001 --gid 1001 --no-create-home snap \
    && chown -R snap:snap /repo

USER snap
WORKDIR /repo/apps/web
EXPOSE 3000

ENTRYPOINT ["pnpm"]
CMD ["start"]
