# Putting Snap Apps online

**Date:** 2026-09-12 · **Status:** the marketing site can go live now; the panels cannot yet

This document is honest about what is ready. Where something is not, it says so
and says what closes it — a deployment guide that describes a system you do not
have is how a launch goes wrong at 2am.

---

## 1. What can go live today, and what cannot

| Surface | Ready? | Why |
|---|---|---|
| Marketing, docs, legal, downloads | **Yes** | Static, public, no session. Earns SEO immediately. |
| Registration and sign-in | **Needs Google credentials** | §3 |
| Individual / business panels | **After sign-in works** | They are wired to the real API. |
| Platform admin console | **Not yet** | §5 |

**The important rule:** the marketing site can be public while the API is not.
Deploy the website against a **non-public** API and nothing is exposed. The
things below that block a launch mostly block *exposing the API*, not
publishing pages.

---

## 2. The preflight decides, not this document

`apps/server/src/preflight.ts` runs at boot, after the app is wired and before
it accepts a connection. In production it **refuses to start** on a fatal
finding and logs warnings for the rest. Verified by running: booting as
`postgres` in production exits with

```
preflight: DATABASE_URL connects as "postgres", which bypasses row-level
security. Every tenant boundary in the database is disabled for this connection.
Refusing to start: 1 production preflight check(s) failed.
```

and booting as `snap_app` logs `preflight ok · database role snap_app · rls enforced`.

| Check | Fatal? | What it is for |
|---|---|---|
| Connection bypasses RLS | **Fatal** | The bug this project shipped once: connected as `postgres`, so no policy was ever evaluated. Nothing about a running system looks different when this is wrong. |
| `CORS_ORIGINS` contains `*` | **Fatal** | These responses carry financial records. |
| No `GOOGLE_CLIENT_ID` | Warning | The dev bypass is 404 in production, so without Google (and without a deliverable mailer) nobody can sign in at all — unless this is the demo host with the simulator enabled (§3). |
| `CORS_ORIGINS` empty | Warning | Every cross-origin browser request refused. Correct if only the native app and a server-side BFF call the API. |
| Local KMS stand-in in use | Warning | §5. |

---

## 3. Blocking: there is no working production sign-in

`/v1/auth/sign-in` traded an email address for a session with no proof of
ownership. It is now **404 in production** — that closed a complete
authentication bypass, and it means the only remaining paths are Google and
magic links.

**To close this:**

1. Create an OAuth client in Google Cloud Console → APIs & Services →
   Credentials → OAuth client ID → Web application.
2. Add `https://<your-domain>/auth/google/callback` to its authorised redirect
   URIs. It must match `WEB_PUBLIC_URL` exactly.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the **web** app, and
   the same `GOOGLE_CLIENT_ID` on the **server** (which needs only the id — it
   verifies the ID token against Google's JWKS and never needs the secret).

No code changes. The flow is built, including PKCE, `state` verification, and
independent ID-token verification server-side.

Magic links work but need a real mailer: `apps/server/src/auth/mailer.ts` is a
console transport in development and a no-op in production. Wire a provider
before relying on them.

**Stopgap for a demo before either of those exists:** a simulated Google
sign-in — `apps/server/src/config.ts#isGoogleSignInSimulatorEnabled`,
`POST /v1/auth/google-simulator/sign-in` — lets a public demo/staging host let
people in as one of the fixed, seeded demo accounts (`apps/server/scripts/
seed.ts`) without real Google credentials or a working mailer. It requires
THREE things set together, none of which a plain production deploy ever sets
by accident:

```
NODE_ENV=production          # same build as everywhere else
DEMO_ENV=staging              # explicit — never inferred from NODE_ENV
GOOGLE_SIGNIN_SIMULATOR=true  # explicit — a second, separate opt-in
```

It turns itself back off the instant `GOOGLE_CLIENT_ID` is actually set, so
there is nothing to remember to unset when real credentials land — see that
function's own comment for the full rationale, and
`apps/server/src/auth/google-simulator.test.ts` /
`apps/web/src/lib/auth/google-simulator.test.ts` for the negative-case tests.
**Do not set these on a real production deploy** — same rule as
`SNAP_DEV_AUTH_BYPASS` below.

---

## 4. Environment

**Server** (`apps/server`):

```
DATABASE_URL          # snap_app — NOT a superuser. The preflight enforces this.
WORKER_DATABASE_URL   # snap_worker
TOKEN_SECRET          # 32+ chars, secret, stable — rotating it signs everyone out
ADMIN_KMS_MASTER_KEY  # 64 hex chars (see §5)
ADMIN_KMS_PROVIDER    # optional, default "local" — set to a real KmsProvider's id once one exists (§5)
PUBLIC_URL            # how this API is reached from outside
CORS_ORIGINS          # comma-separated allow-list; never *
GOOGLE_CLIENT_ID      # §3
NODE_ENV=production

# Demo/staging host ONLY (§3) — leave both unset on a real production deploy:
DEMO_ENV=staging
GOOGLE_SIGNIN_SIMULATOR=true
```

`node packages/db/scripts/db.mjs appuser` prints the two database URLs.

**Web** (`apps/web`): see `apps/web/.env.example`. `SNAP_API_URL` may be a
private address — the browser never talks to the API directly. Set the same
`DEMO_ENV` / `GOOGLE_SIGNIN_SIMULATOR` pair here too, on the demo host only —
the web app and the API each enforce their own copy of the same three
conditions independently (§3).

**Do not set `SNAP_DEV_AUTH_BYPASS=true` in production.** It is guarded by two
independent conditions and `NODE_ENV` alone already disables it, but it should
not be present at all. The same rule applies to `DEMO_ENV` /
`GOOGLE_SIGNIN_SIMULATOR` above — set them on the demo host, never on the
real one.

---

## 5. Enforced for the admin console: the KMS stand-in

`apps/server/src/admin/crypto/kms.ts` wraps data keys with a local master key
read from `ADMIN_KMS_MASTER_KEY`, behind a `KmsProvider` seam (`wrap`/`unwrap`).
It is the correct *shape* — AEAD with a wrapped DEK, ciphertext in `BYTEA`,
never `pgcrypto` — but the master key sits in an environment variable rather
than a hardware-backed cloud KMS.

That is fine for development and is **not** what should protect a live AI
provider credential, and this is no longer only a warning: `encryptApiKey`
**throws** if the active provider is the local stand-in (`ADMIN_KMS_PROVIDER`
unset, or `local`) and `NODE_ENV=production` — storing or rotating a key
through the admin UI fails outright. Reading an already-stored key is
unaffected, so this cannot brick an environment that already has one.

Before storing a real provider key in production: implement a `KmsProvider`
for the real KMS (AWS KMS, GCP KMS, Vault — see that file's header for the
seam) and set `ADMIN_KMS_PROVIDER` to select it. The boot preflight still
warns at startup if the local provider is in play, as an earlier signal than
the first failed key-store attempt.

---

## 6. Known limits at launch

- **Rate limiting and magic-link single-use are in-memory**, so they are
  per-process. Correct on one instance; wrong the moment you run two. Needs
  Redis or equivalent before horizontal scaling.
- **Billing is unbuilt.** `subscriptions` and `usage_counters` exist in schema;
  Stripe is phase 6.5. The UI does not invent a checkout.
- **Legal pages are drafts** and carry a visible banner saying so. They need
  review by an Australian practitioner before launch.
- **The Android APK URL, size and checksum are placeholders** in
  `apps/web/src/lib/releases.ts` — no `eas build` artifact exists yet.
- **iOS is deliberately not downloadable.** The section is full-weight and
  crawlable for SEO, with an inert control and an honest `PreOrder` in its
  structured data. See `docs/WEB.md` §7.
- **The firm/practice console needs server routes.** `firms` and
  `firm_memberships` are schema-only.

---

## 7. Before the first deploy

1. `pnpm -r typecheck`
2. Full suites **with a real database** — they self-skip without one, and a
   skipped suite reads as a green run:
   ```
   DATABASE_URL=postgres://snap_app:...      # not a superuser
   ADMIN_DATABASE_URL=postgres://postgres:... # test provisioning only
   TOKEN_SECRET=... ADMIN_KMS_MASTER_KEY=...
   pnpm --filter @snap/server test && pnpm --filter @snap/db test
   ```
3. `pnpm --filter @snap/web build`
4. Apply migrations: `node packages/db/scripts/db.mjs migrate`
5. Boot the server in production mode and **read the preflight line**. If it
   says `rls BYPASSED`, stop.
6. Check `/v1/ready` reports `rlsEnforced: true`.
7. Confirm `POST /v1/auth/sign-in` returns **404**, not 200. This is the one
   check worth doing by hand against the live host, because getting it wrong
   means every account is open.
8. **Smoke-test the admin plane over real HTTP**, as a staff user with one
   capability. Not optional, and not covered by the test suite:

   ```
   curl -H "Authorization: Bearer <staff session>" https://<api>/v1/admin/me
   ```

   Expect 200 with the staff's capabilities; expect 403, naming the missing
   capability, on a route they do not hold.

> **The suite does not reproduce the production runtime.** Vitest's transformer
> emits `emitDecoratorMetadata`; `tsx` — which runs the server, because the tax
> engine's extensionless imports need a bundler-style resolver — uses esbuild,
> which does not. A Nest class with constructor injection therefore works under
> test and receives `undefined` in production. That is not hypothetical: it took
> out every capability-gated admin route with a 500 while `admin.e2e.test.ts`
> passed 6/6, including its happy-path case. Until the server builds with
> `tsc`/SWC, treat "the tests pass" as insufficient evidence that a DI change
> works, and smoke-test the running process.

---

## 8. Why §7 is a checklist and not a test suite

On 2026-09-12, across two sessions building the website and the admin plane,
**six defects passed their own tests while being broken in what actually runs,
and five test suites passed vacuously.** Not one was caught by typechecking or
by the suite that covered it. Every one was caught by running the real thing
against the real thing.

They share a shape, and it is worth naming because it predicts where the next
one will be: **nothing checks the agreement BETWEEN two correct things.**

| What was correct | What was also correct | What was wrong |
|---|---|---|
| `AdminStaffSummary.capabilities: PlatformCapability[]` in TypeScript | `platform_capability[]` in Postgres | `pg` keys type parsers by OID, has none for a type a migration invented, and returns the string `'{a,b}'`. UI mapping over it iterates characters. |
| Vitest's transformer emits `emitDecoratorMetadata` | `tsx` runs the server (the tax engine needs a bundler resolver) | esbuild does not implement it, so Nest injected `undefined` and every capability-gated admin route 500'd — while its e2e suite passed 6/6, happy path included. |
| The admin console wrote its impersonation cookie | The panels read an impersonation cookie | Different name, different path, different fields. `path: '/admin'` is never sent to `/app/*`, so staff saw their own account believing it was the customer's. |
| The contract declared `IsoDateTime` | Postgres rendered a valid timestamp | Space instead of `T`. V8 parses it leniently, so it worked by luck. `Date.parse` returns NaN on anything stricter, and every NaN comparison is false — an expiry check written the obvious way treats an unreadable timestamp as never expiring. |
| A published contract type | A server DTO | Both compiled. The endpoint was broken for every real client. |
| `isProduction()` guarded the demo-accounts LIST | `/v1/auth/sign-in` had a comment saying it must not ship | The guard was on the wrong endpoint. Anyone reachable could sign in as anyone. |

And the vacuous passes: the database suites are `DATABASE_URL ? describe :
describe.skip`, so with no database they report "197 skipped" and go green
while proving nothing — not tenant isolation, not the admin capability
refusals, not RLS. `REQUIRE_DB=1` now makes that fatal in CI.

**The practical rules that fall out of this**, all of them already applied above:

1. **Run the thing.** A smoke test against the running process catches what no
   unit test can, because the composition is where the defect lives.
2. **Test the refusal, not the permission.** A suite that only proves the happy
   path is what let the RLS bypass survive. Every gate in this system has a
   test asserting it REFUSES, and several were verified by deleting the guard
   and watching the right test fail.
3. **Make the agreement a compile error** where you can — handler returns
   annotated as contract types, DTOs `implements` them — and a runtime
   assertion where you cannot.
4. **Fail closed.** An unreadable expiry, a missing database in CI, a local KMS
   in production: refuse. Do not warn, and do not treat "unknown" as "fine".
5. **A decision recorded in a document is not a control.** Three defects here
   were decisions written down, believed, and never enforced.

---

## 9. Deploying to the VPS (delphi)

Shared hosting cannot run this. It needs two long-lived Node processes (the API
and the extraction worker), Next.js as a server rather than static files, and a
Postgres you can `CREATE EXTENSION` and `CREATE ROLE` on. A KVM VPS is the
target; `deploy/` holds everything.

**Sizing.** 2 vCPU / 4 GB is comfortable. 2 GB works only if you deploy with
`--pull` — see below.

### First time

```bash
deploy/bootstrap.sh                  # docker, app user, data dir, firewall (22/80/443)
cp deploy/.env.example deploy/.env   # then fill it in — §4 and the file's own comments
deploy/deploy.sh --pull              # or bare, to build on the box
```

`deploy.sh` encodes §7: it migrates, creates the non-superuser roles, restarts,
then **verifies** — `/v1/ready` must report `rlsEnforced: true`, and
`POST /v1/auth/sign-in` must return 404. It fails loudly if either is wrong.

### Prefer `--pull`

`next build` is the most memory-hungry step in this stack and is what gets
OOM-killed on a small box, with an error that reads like a code fault rather
than a capacity one. `.github/workflows/publish-images.yml` builds both images
on GitHub and pushes them to GHCR, so the VPS only pulls. The larger benefit is
that the artifact CI tested is the artifact that runs.

**The packages are private, and this is the step that will bite you.** They
inherit the repository's visibility, and a token belonging to a *different*
GitHub account cannot pull them even if that account can read the repo —
verified: pushing succeeded, and `docker manifest inspect` from another account
returned "not accessible".

So on the VPS, once:

```bash
docker login ghcr.io -u <github-user> -p <PAT with read:packages>
```

The PAT must belong to an account that can see `gaiadabali`'s packages — the
repository owner, or an account explicitly granted access under the package's
*Package settings → Manage access*. Alternatively link each package to the
repository (*Package settings → Connect repository*) so repository
collaborators inherit read access.

Then set in `deploy/.env`:

```
SERVER_IMAGE=ghcr.io/gaiadabali/snap-server
WEB_IMAGE=ghcr.io/gaiadabali/snap-web
IMAGE_TAG=sha-<short sha>      # never `latest`
```

`--pull` refuses to run without all three. `latest` is rejected deliberately: a
rollback has to be able to name what it is rolling back to.

### Routine deploy and rollback

```bash
git pull && deploy/deploy.sh --pull        # after CI is green for that SHA
deploy/deploy.sh --rollback <previous sha> # no build, no migration
```

Rollback does not reverse migrations. A migration that must be undone is a
separate, deliberate act — this script never touches the postgres volume.

### Where things are

Logs: `docker compose -f deploy/docker-compose.yml logs -f api worker web`.
Captured originals: the host path in `STORAGE_HOST_DIR` — legal records under
ATO retention, so they must be in the backup set (`deploy/backup.sh`), not just
in a container volume.

---

## 10. Continuous deploy: GitHub → delphi polls → live

The website and server deploy themselves. A systemd timer on the host asks
GitHub every five minutes what the deployable commit is and rolls it out if it
differs from what is running. Nobody SSHes in to ship.

**Deployable is not "newest commit on main".** It is the newest commit whose
**CI passed and whose images were published** — `poll-deploy.sh` intersects the
successful runs of both workflows. A commit can have green images and red
tests; deploying that is worse than not deploying.

Pull rather than push, deliberately: a push deploy needs a credential that can
*change* the server, held by a laptop or a CI runner. Here the server holds one
**read-only** token and nothing outside needs access to it.

```
merge to main
   ├─ CI ................... typecheck, 4 suites, RLS assertion, web build
   └─ Publish images ....... ghcr.io/gaiadabali/snap-{server,web}:sha-<short>
                                          ↓  (delphi polls, ≤5 min)
                             poll-deploy.sh: both green? → git reset --hard
                                          ↓
                             deploy.sh --pull: migrate, roles, restart
                                          ↓
                             verify: /v1/ready rlsEnforced, sign-in 404
```

### The one thing still needed

A **fine-grained PAT** scoped to this repository with `Contents: Read` and
`Packages: Read`, on the host:

```bash
install -m 600 /dev/null /etc/snap-apps/secrets/github.env
echo 'GITHUB_TOKEN=github_pat_...' > /etc/snap-apps/secrets/github.env
systemctl enable --now snap-deploy.timer
journalctl -u snap-deploy.service -f
```

One credential covers both git and GHCR. A deploy key would be tidier for git,
but **deploy keys are disabled by policy on this repository** — confirmed, the
API returns 422 — and one read-only token is arguably better anyway: less to
rotate, and it cannot write.

Until that file exists the poller exits cleanly each tick with
`FAILED: /etc/snap-apps/secrets/github.env not found`, which is why the timer
ships disabled: enabling it first would fill the journal with a failure nobody
needs repeated every five minutes.

### What is already in place on delphi

`/opt/snap-apps` (repo + `deploy/.env` with secrets generated on-host, chmod
600), `/etc/snap-apps/secrets/ollama.env` (extraction key, chmod 600),
`/opt/snap-apps/data/storage`, and both systemd units installed.

`bootstrap.sh` was deliberately **not** run. It does `ufw default deny
incoming` and `ufw --force enable` permitting only 22/80/443, and this host
also serves 6081 (Varnish) and 8443 (nginx) publicly — it would have cut live
services. Docker 29.8 and Node 22 were already installed, so it had nothing to
offer that was worth that risk.

### Mobile

`.github/workflows/mobile-build.yml` is the same shape, ending in an artifact
rather than a server. Tag- or button-triggered rather than per-commit, because
EAS builds cost plan minutes and take 10–20 minutes each. It needs an
`EXPO_TOKEN` secret and an EAS project id (`npx eas login && npx eas init`),
and refuses up front naming which is missing — including refusing to build a
profile whose `EXPO_PUBLIC_API_URL` is still a placeholder, since that value is
inlined at build time and cannot be changed afterwards.

---

## 11. The staging addresses (delphi)

Two addresses, following the pattern the other projects on this host already
use (`pilot-fullstack-cms{,-api}.gaiada.online`):

| Address | Serves | Consumed by | Loopback port |
|---|---|---|---|
| `snap-apps.gaiada.online` | Website + individual / business / admin panels | Browsers | 3300 |
| `snap-apps-api.gaiada.online` | The API | Website (server-side), the browser app, the phone app | 3301 |
| `snap-apps-app.gaiada.online` | **The mobile app, exported for the browser** | Reviewers, before anyone installs anything | 3302 |

The third exists because the dev review looks at the app in a browser rather
than on a phone. Expo exports the same React Native source as a web bundle, so
it is the real app — same screens, same seam, same `@snap/api-contract` types —
not a mock. The phone build is unaffected: `eas.json`'s `preview` profile still
produces an installable APK pointed at the same API, and `docs/BUILD.md` §6
covers that path.

**The browser build is subject to CORS and the phone build is not.** A native
app is not governed by the same-origin policy at all; a web bundle is. So
`CORS_ORIGINS` must name `https://snap-apps-app.gaiada.online` as well as the
website, or every request the app makes fails at preflight and surfaces as a
network error indistinguishable from being offline. That precise failure has
already cost this project a day once, when a missing header on the allow-list
meant the offline outbox could queue writes it could never send.

### How they were made

This host runs **CloudPanel**, so sites are created with `clpctl`, not by
hand-writing vhosts — the same way every other site here exists:

```bash
clpctl site:add:reverse-proxy --domainName=snap-apps.gaiada.online \
  --reverseProxyUrl='http://127.0.0.1:3300' --siteUser=snapwebonl --siteUserPassword='...'
```

Site users `snapwebonl` / `snapapionl`; their passwords are on the host in
`/etc/snap-apps/secrets/cloudpanel-sites.env` (chmod 600).

**The ports are not the defaults, deliberately.** `127.0.0.1:3000` is already
referenced by another project's vhost on this box. Nothing is listening on it,
so a naive check calls it free — and taking it would have made that project's
domain quietly serve this application to its visitors. 3300/3301 are referenced
nowhere in nginx and unbound.

### Still required, and neither can be done from here

**1. DNS.** `gaiada.online` is on GoDaddy (`ns37/ns38.domaincontrol.com`). Add
two A records pointing at `72.61.142.88`:

```
snap-apps.gaiada.online        A   72.61.142.88
snap-apps-api.gaiada.online    A   72.61.142.88
```

**2. TLS, once DNS resolves.** Let's Encrypt validates over HTTP, so this must
come second or it fails:

```bash
clpctl lets-encrypt:install:certificate --domainName=snap-apps.gaiada.online
clpctl lets-encrypt:install:certificate --domainName=snap-apps-api.gaiada.online
```

**3. The GitHub token** (§10). Once it is in place the poller deploys within
five minutes and the addresses go live.

Until the containers run, both addresses answer 502 from nginx. That is the
proxy behaving correctly with nothing behind it, not a misconfiguration.
