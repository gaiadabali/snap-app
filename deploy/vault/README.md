# Vault on delphi — initialise, unseal, and what breaks

`docs/INTEGRATIONS.md` Lane K. This is the operator procedure for the `vault`
service in `deploy/docker-compose.yml`. Every command below was run against
`hashicorp/vault:1.20.4` with this exact `config.hcl` on 2026-09-21.

---

## The cost this design carries, stated first

**A restarted Vault comes back SEALED, and nothing unseals it automatically.**

That is not an oversight. Auto-unseal exists, and every variant of it needs a
second key-holder — AWS KMS, GCP KMS, or another Vault — which is the cloud
dependency this deployment was chosen to avoid. Shamir unseal is the honest
trade: no cloud, and a human with two key shares after every restart.

What that means in practice, and it is worth knowing before the first
unattended reboot:

| Vault state | AI provider keys | Xero tokens (Lane Y) | Everything else |
|---|---|---|---|
| Unsealed | readable, writable | readable, refreshable | fine |
| **Sealed** | **unreadable** | **unrefreshable** | **fine** |

The last column is the important one. Capture, extraction, the ledger, BAS,
statements and reconciliation do not touch the KMS at all, so a sealed Vault
is **not an outage of the product** — it is an outage of the features that
read a stored credential. The API boots, `/v1/ready` answers, and the app
works. Do not treat a sealed Vault as a reason to roll back a deploy.

`snap-deploy` restarts containers on a five-minute poll, so **plan for this**:
after any deploy that recreates the `vault` container, somebody unseals it.

---

## First-time initialisation

Once, ever. Re-running it against an initialised Vault is refused.

```bash
ssh delphi
cd /opt/snap-apps
docker compose up -d vault

# 3 shares, any 2 of which unseal. Capture this output — it is shown ONCE
# and cannot be recovered.
docker compose exec vault sh -c \
  'wget -qO- --post-data="{\"secret_shares\":3,\"secret_threshold\":2}" \
   http://127.0.0.1:8200/v1/sys/init'
```

The response carries `keys_base64` (3 unseal shares) and `root_token`.

**Where those go, and where they must not:**

- The three shares go to **three different places, none of them this server**
  and none of them the `vault_data` volume. A share stored beside the thing it
  unseals is not a share.
- The root token is used for the setup below and then **revoked**. It is not
  the token the application uses.
- Neither goes in this repository. `.gitignore` covers `.env`; that is not a
  reason to put them anywhere near it.

## Unsealing — after every restart

```bash
docker compose exec vault sh -c \
  'wget -qO- --post-data="{\"key\":\"<share-1>\"}" http://127.0.0.1:8200/v1/sys/unseal'
docker compose exec vault sh -c \
  'wget -qO- --post-data="{\"key\":\"<share-2>\"}" http://127.0.0.1:8200/v1/sys/unseal'
```

The first returns `"sealed": true, "progress": 1`; the second returns
`"sealed": false`. The compose healthcheck greps for exactly that, so
`docker compose ps` flips `unhealthy` → `healthy` within 30 seconds — which is
the signal to watch rather than the API logs.

## Setting up the transit engine — once, after the first unseal

```bash
export VAULT_TOKEN=<root-token>

# The engine the KmsProvider talks to.
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' \
   --post-data='{\"type\":\"transit\"}' http://127.0.0.1:8200/v1/sys/mounts/transit"

# The named key that wraps every DEK. `snap-dek` matches VAULT_TRANSIT_KEY's
# default in docker-compose.yml — change both or neither.
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' --post-data='' \
   http://127.0.0.1:8200/v1/transit/keys/snap-dek"
```

## The application's token — not the root token

The app needs exactly two capabilities: encrypt and decrypt under one key. Give
it that and nothing else, so a leaked application token cannot read Vault's
other secrets, rotate the key, or read the key material.

```bash
# A policy that permits the two operations the KmsProvider makes.
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' --post-data='{
     \"policy\": \"path \\\"transit/encrypt/snap-dek\\\" { capabilities = [\\\"update\\\"] }
                  path \\\"transit/decrypt/snap-dek\\\" { capabilities = [\\\"update\\\"] }\"
   }' http://127.0.0.1:8200/v1/sys/policies/acl/snap-app"

# A periodic token: renewable indefinitely, dead within 72h if nothing renews
# it. Put the returned client_token in deploy/.env as VAULT_TOKEN.
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' \
   --post-data='{\"policies\":[\"snap-app\"],\"period\":\"72h\"}' \
   http://127.0.0.1:8200/v1/auth/token/create"
```

Then revoke the root token:

```bash
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' --post-data='' \
   http://127.0.0.1:8200/v1/auth/token/revoke-self"
```

## Rotating the KEK

The reason the envelope exists. Nothing already stored is re-encrypted; old
ciphertexts keep their `vault:v1:` prefix and Vault keeps the v1 key to read
them. Proven by a test (`vault-transit.test.ts`, and against a real Vault in
`vault-transit.live.test.ts`) rather than asserted here.

```bash
docker compose exec vault sh -c \
  "wget -qO- --header='X-Vault-Token: $VAULT_TOKEN' --post-data='' \
   http://127.0.0.1:8200/v1/transit/keys/snap-dek/rotate"
```

## Backups

`vault_data` holds the sealed key material. It belongs in the same backup set
as Postgres, and the unseal shares belong somewhere that backup is not —
otherwise the backup is the key and the lock in one envelope.

**Losing `vault_data` is unrecoverable.** The ciphertext in Postgres survives
and nothing can unwrap it. There is no support path for this.

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
