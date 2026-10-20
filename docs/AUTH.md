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
