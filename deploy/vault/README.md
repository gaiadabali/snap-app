# Vault on the host (helios) — initialise, unseal, and what breaks

`docs/INTEGRATIONS.md` Lane K. This is the operator procedure for the `vault`
service in `deploy/docker-compose.yml`, run against `hashicorp/vault:1.20` with
this exact `config.hcl`. The scripts in this directory were tested against a
throwaway container of that image before they were merged.

| File | What it is |
|---|---|
| `unseal.sh` | unseals Vault when it is sealed; silent otherwise. Run every minute by the timer |
| `snap-vault-unseal.service` / `.timer` | the systemd units that run it |
| `mint-app-token.sh` | mints a new app token on a healthy Vault and writes it to `deploy/.env` |
| `init-fresh.sh` | initialises a brand-new, uninitialised Vault end to end |
| `lib.sh` | helpers shared by the three scripts above (sourced, never run) |
| `renew-token.sh` | the 12-hourly renewal of the app token |
| `config.hcl` | the server config |

---

## The cost this design carries, stated first

**Decision, 2026-10-20 (the owner): Vault unseals itself, on the box.** This
replaces the 2026-09-21 design, where a human with two key shares unsealed
Vault by hand after every restart. In practice nobody did: Vault came back
sealed after every host reboot and stayed that way, and the app's token died
unrenewed.

How it works now: two of the three Shamir shares live on helios in a root-only
file, `/etc/snap-apps/secrets/vault-unseal`. A systemd timer runs
`unseal.sh` every minute and submits them when Vault is sealed. The third share
stays off the box with the owner.

**The trade-off, plainly: root on helios, or a copy of its disk image, now
holds both the locked data and the key.** Before, a thief with the disk had a
locked box. Now they have the box and two of the three keys. What the third
share still buys: a Vault restored from a *backup* onto some other machine
stays locked unless the owner supplies it, and the owner can still generate a
root token by hand from a third share plus one on the box.

Consequences that are deliberate:

- **`backup.sh` and `offsite.sh` exclude the shares file.** It lives under
  `/etc/snap-apps/secrets/`, which neither script includes. `backups/vault`
  holds Vault's *sealed* data and goes offsite; the shares must never travel
  with it, or the offsite copy is the key and the lock in one envelope. Do not
  add that directory to either script.
- **The third share is not on this host.** `init-fresh.sh` writes it to a
  clearly named file for the owner to copy away and delete; it is never part of
  the timer's input.
- **Nothing secret goes in a process's argv.** helios is shared and
  `/proc/*/cmdline` is world-readable, so every script passes shares over
  stdin and tokens as environment variables (see `lib.sh`). Do the same by hand;
  the manual commands below do.

What a sealed Vault costs, which is why a one-minute timer is worth having:

| Vault state | AI provider keys | Xero tokens (Lane Y) | Everything else |
|---|---|---|---|
| Unsealed | readable, writable | readable, refreshable | fine |
| **Sealed** | **unreadable** | **unrefreshable** | **fine** |

Capture, extraction, the ledger, BAS, statements and reconciliation do not
touch the KMS, so a sealed Vault is not an outage of the product, only of the
features that read a stored credential. Do not treat a sealed Vault as a reason
to roll back a deploy.

---

## Install the auto-unseal (on helios, as root)

Prerequisite: Vault is initialised and you hold at least two shares (otherwise
use `init-fresh.sh` below, which does steps 1 and 2 for you).

```bash
# 1. The shares file: root-owned, mode 600, one base64 share per line, TWO lines.
#    Create it so the shares never appear in a command line or in shell history:
#    (On helios the directory already exists as 711 on purpose; `install -d -m`
#    would tighten it and lock the app containers out of their key file, so
#    there skip this line.)
install -d -m 700 -o root -g root /etc/snap-apps/secrets
umask 077
cat > /etc/snap-apps/secrets/vault-unseal     # paste share, Enter, paste share, Enter, Ctrl-D
chown root:root /etc/snap-apps/secrets/vault-unseal
chmod 600 /etc/snap-apps/secrets/vault-unseal

# 2. The timer. /opt/snap-apps is a git checkout kept current by the deploy
#    poller, so the script is already on the host; only the units are copied.
cp /opt/snap-apps/deploy/vault/snap-vault-unseal.service /etc/systemd/system/
cp /opt/snap-apps/deploy/vault/snap-vault-unseal.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now snap-vault-unseal.timer
```

`unseal.sh` refuses (exit 1, one line in the journal) if the shares file is
missing, not owned by root, or readable by group/other. `UNSEAL_ALLOW_ANY_OWNER=1`
skips that check; it exists only so the script can be tested on a laptop, and
**must never be set on helios**.

Check it:

```bash
systemctl list-timers snap-vault-unseal.timer     # next/last run
journalctl -u snap-vault-unseal -n 20             # one line per unseal or failure
/opt/snap-apps/deploy/vault/unseal.sh; echo $?    # by hand: silent + 0 when already unsealed
docker compose -f deploy/docker-compose.yml ps vault   # healthy again within ~30s of an unseal
```

The journal is silent while Vault is unsealed (the timer fires every minute, so
it only logs when it acts). `vault was sealed; unsealed` is the normal line
after a reboot; anything else is a failure and exits non-zero.

---

## First-time initialisation, or starting fresh

Two situations, one script. `init-fresh.sh` refuses unless Vault reports
`initialized:false`, so it can never touch a live Vault, and it never deletes or
moves the `vault_data` volume (clearing an old Vault out of the way is a manual
step you do first, after deciding that nothing encrypted under it matters).

```bash
cd /opt/snap-apps
docker compose -f deploy/docker-compose.yml up -d --no-deps --pull never --no-build vault   # only if it is not running
deploy/vault/init-fresh.sh
```

It initialises with 3 shares / threshold 2, writes shares 1 and 2 to
`/etc/snap-apps/secrets/vault-unseal` (600) and share 3 to
`/etc/snap-apps/secrets/vault-share-3-TAKE-OFF-BOX` (600) (it creates the
directory mode 700 only if it is missing; an existing one keeps its mode, since
helios's is 711 on purpose for the app containers' key file), unseals, creates the
`transit` mount, the `snap-dek` key, the `snap-app` policy and an app token,
writes that token into `deploy/.env`, and revokes the initial root token. It
prints step names only. **Then the owner copies share 3 off the box and runs
`shred -u` on it**, as the script's closing notice says, and the next-step
command below is run. Install the timer (above) if it is not yet installed.

If Vault is already initialised and you still hold the shares, skip this and
use `mint-app-token.sh`.

## Unsealing — after every restart

Automatic: `snap-vault-unseal.timer` (above). By hand, with the same rule (the
share goes over stdin, never into a command line):

```bash
deploy/vault/unseal.sh
```

or, for one share typed at a prompt:

```bash
read -rs SHARE; printf '{"key":"%s"}' "$SHARE" \
  | docker exec -i snap-apps-vault-1 wget -qO- --post-file=/dev/stdin http://127.0.0.1:8200/v1/sys/unseal; unset SHARE
```

The first share returns `"sealed":true,"progress":1`, the second `"sealed":false`.
The compose healthcheck greps for exactly that, so `docker compose ps` flips
`unhealthy` → `healthy` within 30 seconds.

## The application's token — two ways to mint a new one

The app needs exactly two capabilities, encrypt and decrypt under one key, plus
renewing its own token, so a leaked token cannot read Vault's other secrets,
rotate the key, or read the key material. The policy `snap-app` is:

```hcl
path "transit/encrypt/snap-dek" { capabilities = ["update"] }
path "transit/decrypt/snap-dek" { capabilities = ["update"] }
path "auth/token/renew-self" { capabilities = ["update"] }
```

The token is a **periodic, orphan** token (72h period). Orphan matters: a plain
`token/create` makes a child of the root token, and Vault revokes every child
when its parent is revoked, so revoking the root would silently kill the app's
token and every wrap would 403 (this happened on helios, 2026-10-02).

**A. Vault is healthy, the token is dead: `mint-app-token.sh`.** Unseals if
needed, generates a *temporary root token* from two shares in the shares file
(`sys/generate-root`), makes sure the transit mount and `snap-dek` exist,
writes the policy, creates a new orphan periodic token, backs up `deploy/.env`
to `.env.bak-<UTC stamp>-vault-token` (600), replaces its `VAULT_TOKEN=` line in
place (owner and mode kept), and revokes the root token, **even if a step
failed** (it is in a trap). No human sees a share or a token. The old token is
not revoked; it simply expires.

**B. Start over: `init-fresh.sh`** (above). Same provisioning, preceded by `sys/init`.

Neither restarts anything. The app reads `VAULT_TOKEN` at container start, so
after either script, recreate `api` and `worker` through the documented
non-bare path (never a bare `docker compose up`: it would try to build docai
from source; see `docs/DEPLOY.md` section 10):

```bash
cd /opt/snap-apps
DOCAI_IMAGE=ghcr.io/gaiadabali/snap-docai IMAGE_TAG=sha-<deployed> \
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  up -d --no-deps --pull never --no-build --force-recreate api worker
```

(`sha-<deployed>` is the `IMAGE_TAG=` line in `deploy/.env`.)

## Keeping the token alive

Nothing in the app renews `VAULT_TOKEN` (`vault-transit.ts`: "No token
renewal"). Root's crontab on the host renews it every 12h:

```
0 */12 * * * /opt/snap-apps/deploy/vault/renew-token.sh >> /var/log/snap-vault-renew.log 2>&1
```

The cron line runs `renew-token.sh` from the checkout itself, so a fix to it
arrives with the next deploy. (Until 2026-10-20 it ran a hand-made copy at
`/usr/local/sbin/snap-vault-renew.sh`, which put the token in a process argv
and never received a fix.) It exports an explicit PATH because cron on this
host has none worth having, reads `VAULT_TOKEN` from `deploy/.env`, and runs
`vault token renew` in the vault container with the token passed as an
environment variable. A sealed Vault fails here, which is why the unseal timer
matters; if the host is down or Vault is sealed for more than 72h the token
expires and `mint-app-token.sh` re-mints it.

## Rotating the KEK

The reason the envelope exists. Nothing already stored is re-encrypted; old
ciphertexts keep their `vault:v1:` prefix and Vault keeps the v1 key to read
them. Proven by a test (`vault-transit.test.ts`, and against a real Vault in
`vault-transit.live.test.ts`) rather than asserted here. Needs a root token:
generate one the way `mint-app-token.sh` does, use it, and revoke it.

```bash
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' --post-data='' \
   http://127.0.0.1:8200/v1/transit/keys/snap-dek/rotate"
```

(That form puts the token in argv for the moment it runs; on helios prefer
`VAULT_TOKEN=... docker exec -e VAULT_TOKEN snap-apps-vault-1 vault write -f transit/keys/snap-dek/rotate`
with the token supplied from a variable that is never echoed.)

## Backups

`vault_data` holds the sealed key material. `backup.sh` snapshots it nightly to
`backups/vault`, and `offsite.sh` ships that offsite. It belongs in the same
backup set as Postgres, and **the unseal shares belong somewhere that backup is
not**: the shares file and the third share are excluded on purpose (see "The
cost this design carries"), otherwise the backup is the key and the lock in one
envelope.

**Losing `vault_data` is unrecoverable.** The ciphertext in Postgres survives
and nothing can unwrap it. There is no support path for this. A restored
`vault_data` also needs the *same* shares it was initialised with: after an
`init-fresh.sh` the old backups' shares no longer match, so keep the shares that
match each backup generation.

## Verifying it actually works

```bash
# From the api container, so it proves the path the app uses.
docker compose exec api sh -c 'wget -qO- $VAULT_ADDR/v1/sys/health'
```

And the client itself, against this Vault rather than the simulator:

```bash
VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=<app-token> \
  npx vitest run src/admin/crypto/vault-transit.live.test.ts
```

That suite **skips** without those two variables, and a skipped suite is not a
passed one — if it prints `3 passed`, the real Vault answered.
