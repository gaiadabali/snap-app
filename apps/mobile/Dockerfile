# The mobile app, exported for the browser.
#
# For the dev review the app is looked at in a browser rather than installed on
# a phone. Expo can export the same React Native source as a web bundle, so
# this is the REAL app — the same screens, the same seam, the same
# `@snap/api-contract` types — not a mock of it.
#
# It does not replace the phone build. `eas.json`'s profiles still produce an
# installable APK, and `docs/BUILD.md` §6 covers that path. This is an
# additional target, and it is genuinely useful beyond the review: a browser
# build is the fastest way to show the app to someone who will not install
# anything.
#
# WHAT IS DIFFERENT ABOUT THIS TARGET, and it matters:
#
#   * `EXPO_PUBLIC_API_URL` is inlined at BUILD time and cannot be changed
#     afterwards, exactly as for a native build. It is a build arg here, so the
#     image is bound to one API — rebuild to point somewhere else.
#
#   * Running in a browser makes it subject to CORS, which the native app never
#     is. The API's CORS_ORIGINS allow-list MUST name this app's origin or every
#     request fails at preflight, surfacing as a network error indistinguishable
#     from being offline. This project has already lost a day to that once (the
#     offline outbox could never drain because a header was missing from the
#     allow-list), so it is called out here rather than discovered again.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo

# Manifests first, so a source change does not re-resolve the whole workspace.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/docai/package.json packages/docai/package.json
COPY packages/tax-engine/package.json packages/tax-engine/package.json
COPY packages/docai-preview/package.json packages/docai-preview/package.json
RUN pnpm install --frozen-lockfile --filter "@snap/mobile..."

COPY packages/api-contract packages/api-contract
# apps/mobile declares @snap/docai-preview and `src/lib/device-read.ts`
# imports `structure` from it (OD-8). Without this the web export fails with
# "Unable to resolve module @snap/docai-preview" and the whole Publish images
# run goes red, which blocks the deploy for every service — snap-server,
# snap-web and snap-docai all published fine and none of them could ship.
#
# Second time today in the same shape: apps/server/Dockerfile was missing
# @snap/tax-rules and @snap/docai-preview, and the API crash-looped on boot.
# CI cannot catch it — `pnpm -r typecheck` resolves the workspace from the
# repo, where the package is simply present. The image is the only place it is
# absent, and nothing in CI runs the image.
COPY packages/docai-preview packages/docai-preview
COPY apps/mobile apps/mobile

# Empty by default = the fixture/demo build, which is the safe thing to get if
# somebody forgets to pass it: obviously offline data rather than a build
# silently pointed at the wrong server.
ARG EXPO_PUBLIC_API_URL=""
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}

WORKDIR /repo/apps/mobile
RUN npx expo export --platform web --output-dir /export

# ── runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=build /export /usr/share/nginx/html

# Expo Router builds a single-page app: every route is resolved client-side, so
# a deep link like /receipts/123 has no file on disk and must fall through to
# index.html. Without this, the app works until someone reloads on any screen
# other than the first, which is precisely what a reviewer does.
RUN printf '%s\n' \
    'server {' \
    '  listen 3000;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '  location /_expo/ { expires 1y; add_header Cache-Control "public, immutable"; }' \
    '  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }' \
    '  location / { try_files $uri $uri.html $uri/ /index.html; }' \
    '}' > /etc/nginx/conf.d/default.conf \
    && rm -f /etc/nginx/conf.d/default.conf.bak

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
