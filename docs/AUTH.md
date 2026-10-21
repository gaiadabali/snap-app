# Sign-in safety: sessions, password reset, email verification

Task 1.2, built 2026-10-20 (migration `0036_sign_in_safety.sql`). This holds
until Snap Apps moves to "Sign in with YourTal" (`docs/ECOSYSTEM.md`), which
retires Snap Apps' own passwords. Until then real people may arrive, and these
are the rules they are protected by.

## Sessions

A session is a signed bearer token **and** a row in `user_sessions`. The token
carries a random secret; the row holds only its SHA-256. `SessionGuard` checks
the signature, then `identity_session_check` finds the live row on every
request, in the same single round trip that used to read the user.

| | | Why |
|---|---|---|
| Absolute lifetime | 30 days | NIST SP 800-63B: re-authenticate an AAL1 credential at least every 30 days. Nothing extends it. |
| Idle lifetime | 14 days, sliding | Someone who opens the app every week or two stays in; a lost phone or a lifted token dies two weeks after its last use. |
| Ceiling | 90 days | A CHECK on the table, so no configuration mistake makes a session that never ends. |

Revocation: `POST /v1/auth/sign-out` (this session, always 204),
`POST /v1/auth/sign-out-everywhere` (every session, this one included),
a password reset (every session), a password change (every other session), and
the first proof of an address on an account whose password was set while it
was unproven (every session — see "Pre-hijacking").

There is no refresh token. Revocation is already immediate because every
request reads the row, and the sliding idle window does what a refresh would.
When the server ends a session the phone app clears it once and shows sign-in
("Your session has ended"); `apps/mobile/src/api/context.ts#endSession`.

**Deploying 0036 signs everybody out once**: older tokens have no row.

## Password reset (link, not code)

`POST /v1/auth/password/reset/request {email}` → always `200 {ok:true}`, the
same body and the same database work whether or not the address exists; the
mail is sent after the response. The link
(`WEB_PUBLIC_URL/reset-password?token=…`) is 32 random bytes, stored hashed,
**single use, 30 minutes**, and replaced by any newer request.

`POST /v1/auth/password/reset/confirm {token, newPassword}` → sets the password
(scrypt, `auth/passwords.ts`), marks the address verified, revokes every
session, mails "your password was changed", and answers like a sign-in
(`{token, user, workspaces}`). A dead link is `401 invalid_link`.

`POST /v1/auth/password/change {currentPassword, newPassword}` (signed in) →
revokes every other session and mails the same notice.

## Email verification

`users.email_verified_at`. Proven by: the link mailed at password sign-up
(`/verify-email?token=…`, single use, 24 hours, confirmed by a button so a
mail scanner cannot do it), a password reset, a magic link, or Google.
`POST /v1/auth/email/verification/resend` (signed in) and
`POST /v1/auth/email/verification/confirm {token}`.

**Existing accounts are backfilled as verified, once.** 0036 marks every
account that exists when it runs as proven (founder decision 2026-10-20: they
are internal testers and seeded demo people, and staging invites must keep
working). Only accounts created after the deploy have to verify. A backfilled
account counts as already proven, so the pre-hijacking rule below never clears
its password or sessions.

**An unverified account** signs in and uses its own workspaces fully. It may
**not** invite anyone, accept an invitation (matched by email address) or link
accounting software: `VerifiedEmailGuard`, `403 email_unverified`.

## Two holes this closed

- **Registration took over accounts.** `register` attached a password to any
  existing account that had none and returned a session — every magic-link and
  Google account, for the price of its address. Registration now only creates
  new accounts; an existing one adopts a password through the reset link.
- **Pre-hijacking.** Register someone's address with your password, wait for
  them to arrive by magic link, keep your password. The first proof of the
  address now clears a password set while it was unproven and revokes its
  sessions (`identity_email_proven`).

## Limits (15-minute windows, counted in Postgres)

| Route | Per address / account | Per IP |
|---|---|---|
| reset request | 3 | 10 |
| reset confirm | – | 10 |
| password change | 5 | – |
| verification resend | 3 | 10 |
| verification confirm | – | 20 |

Per-IP limits use the real client address: the API trusts only private proxy
hops (`trustProxy` in `main.ts`) and the website forwards the browser's
`X-Forwarded-For`. Before this, every request appeared to come from the proxy,
so each "per IP" limit was one bucket for everyone. This needs nginx to send
`X-Forwarded-For` (`deploy/nginx-vhost.conf.example` does).

## Mail

Resend over SMTP (`SMTP_URL`, `MAIL_FROM`) through the existing mailer. Every
send is recorded in `mail_deliveries` (purposes `password_reset`,
`email_verification`, `security_notice`). Reset and verification links are
never queued for retry, for the magic link's reason: a queue would store a live
token at rest.

## Sign in with YourTal (group task 3.3, migration `0039_yourtal_sign_in.sql`)

SnapApp is an OpenID Connect client of YourTal. The contract is YourTal's
`docs/26-sign-in-with-yourtal.md`; this is how SnapApp implements its side.
Off unless `YOURTAL_OIDC_ISSUER` and a client id are set (`deploy/.env.example`).

**Flow.** `POST /v1/auth/yourtal/start {client: web|mobile, returnTo?, signUp?, locale?}`
→ `{url, flowId, expiresAt}`. The server makes `state`, `nonce` and a PKCE
verifier (S256) and keeps them in a 10-minute, single-use row
(`yourtal_sign_in_flows`); scopes `openid email profile account`,
`ui_locales`, and `prompt=create` for sign-up. `returnTo` must be a path on
this site, judged after dot segments are resolved. YourTal returns `code`,
`state`, `iss` to the redirect URI; `POST /v1/auth/yourtal/finish {flowId, code, state, iss}`:

1. takes the flow (once; a wrong `state` still spends it) and compares `state`;
2. compares `iss` exactly with the issuer YourTal's discovery document names;
3. redeems the code with openid-client 6.x — the website as a confidential
   client (`private_key_jwt`), the phone app as a public one — with PKCE;
4. verifies the ID token: **its signature against YourTal's published JWKS
   by `kid` (RS256)** — openid-client skips this by default for a token from
   the token endpoint, so `oidc.ts` turns it on with
   `enableNonRepudiationChecks` — then `iss`, `aud`, `nonce`, expiry;
5. re-checks the claims: region AU or ID; `age_band` adult (a teen gets
   `teen_invite_required` until invites exist, 3.10); `email_verified` true;
   the email printable ASCII and already lower-case (refused, never
   case-folded);
6. finds, links or creates the account and opens a session.

`GET /v1/auth/yourtal` says which clients are on. No YourTal token is stored,
logged or returned; logs record the outcome, and the error filter redacts
query parameters from any failed query it logs.

**Which account (`identity_yourtal_sign_in`, SECURITY DEFINER).** The key is
`users.subject = 'yourtal|<sub>'`; `users.yourtal_linked_at` records when the
account was first linked. Either mark makes an account "linked".
1. A known `sub`: that account. Its email and name copies follow YourTal; an
   email another account holds — including one taken by a racing sign-in
   (the unique violation is caught) — is not taken: the copy stays, and an
   `email_collision` row goes to `yourtal_sign_in_reviews`.
2. A new `sub` whose verified email belongs to an account that is not linked
   and whose subject is a legacy format — `dev|<email>` (magic link, Google,
   demo and development sign-in, seeded people) or `pwd|<email>` (password
   registration) — is linked to it, once. **Every link closes the other
   doors in the same transaction:** the password is removed, every existing
   session ends (`revoked_reason = 'yourtal_linked'`), and every mailed link
   stops working.
3. A new `sub` whose email belongs to an already linked account is never
   linked: `second_sub` in the review list, and the person gets
   `account_review`. Any other subject format: `unlinkable_account`, same.
4. Otherwise a new account.
A linked person is never looked up by email to sign them in again.

**Staff** (`platform_staff`, not revoked) must arrive with `amr` containing
`hwk` or `mfa` (`staff_strong_auth_required`) and an `auth_time` within the
last 12 hours (`staff_reauth_required`), checked before anything is written.

**SnapApp's own doors are closed in SQL for a linked account.**
`identity_session_open`, through which every SnapApp sign-in method (and any
older image of this API) opens a session, refuses a linked account with
SQLSTATE `YT001`, reading the user row `FOR SHARE` in the same call, so a
sign-in racing a link cannot slip a session in. YourTal sessions open only
through `identity_yourtal_session_open`, which refuses an account that is not
linked. The API answers `YT001` with 403 `use_yourtal`. A linked account gets
no password-reset mail and no magic-link mail; its old password is gone, so
password sign-in answers the ordinary 401 (saying "use YourTal" there would
reveal which addresses are linked). Accounts not yet linked keep every method
until 3.3.d retires them.

**Website.** "Sign in with YourTal" / "Create account with YourTal" are plain
links (never prefetched: the start route has side effects) to `/auth/yourtal`
(`?signUp=1` for sign-up), which keeps the flow id in a 10-minute
`snap_yt_flow` cookie (httpOnly, Secure, SameSite=Lax, path `/auth/yourtal`);
`/auth/yourtal/callback` finishes, sets the session cookie and goes to the
stored `returnTo` (or onboarding). YourTal's own refusals
(`error=access_denied` with `account_on_hold`, `region_not_supported`,
`teen_*`, `user_cancelled`) map to messages in `lib/auth/yourtal-errors.ts`;
the API's refusals carry their own message.

**Phone app (3.3.c).** The sign-in screen shows "Sign in with YourTal" (and the register screen "Create account with YourTal") only when `GET /v1/auth/yourtal` says `mobile`. It calls `start` with `client: "mobile"`, opens the URL with `expo-web-browser`'s `openAuthSessionAsync` (the system browser, never a WebView) and returns to the private-use redirect `au.com.snapapps.app:/oauth/yourtal` (second entry in `scheme` in `app.json`; `app/+native-intent.ts` keeps the router from treating it as a screen). It reads `code`, `state`, `iss` (or `error`) from the return URL, calls `finish`, and stores the returned SnapApp session in SecureStore exactly as any sign-in does. Cancel or dismiss returns quietly. Nothing from YourTal is stored, and the URL, code, state and token are never logged. Words: `src/lib/yourtal-signin.ts`; the old sign-in's `use_yourtal` shows "This account now signs in with YourTal" above the YourTal button.

**The website key.** `pnpm --filter @snap/server yourtal:oidc-key new <file>`
makes an RS256 key, writes the private JWK (mode 0600) and prints the public
JWK YourTal registers for the website client; `… public <file>` prints it again.
On the host: `/etc/snap-apps/secrets/yourtal-oidc-web.jwk`, named by
`YOURTAL_OIDC_KEY_FILE_HOST`. A missing key file is looked for again at most
once a minute.

**Tests.** `auth/yourtal-signin/yourtal-signin.db.test.ts` runs a real
`oidc-provider` 9.x as the stand-in YourTal (`test-support/fake-yourtal-oidc.ts`:
PKCE required, pairwise subjects, `iss` parameter, the claims, `amr` and
`auth_time`) against a real Postgres, including a provider that publishes the
wrong signing key, codes issued to the other client, a wrong nonce, and a
racing email claim.
