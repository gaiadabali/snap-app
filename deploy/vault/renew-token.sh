#!/bin/sh
# Renews the snap-app periodic Vault token (72h period). Run every 12h from root's crontab.
# Reads the token from deploy/.env; never prints it. A sealed Vault fails here and alert.sh reports that.
T=$(grep '^VAULT_TOKEN=' /opt/snap-apps/deploy/.env | cut -d= -f2-)
docker exec snap-apps-vault-1 wget -qO- --header="X-Vault-Token:$T" --post-data='' \
  http://127.0.0.1:8200/v1/auth/token/renew-self >/dev/null 2>&1 \
  && echo "[$(date -u +%FT%TZ)] vault token renewed" || { echo "[$(date -u +%FT%TZ)] vault token renew FAILED" >&2; exit 1; }
