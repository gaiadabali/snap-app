#!/bin/sh
# Renews the snap-app periodic Vault token (72h period). Run every 12h from root's crontab.
# Reads the token from deploy/.env; never prints it. A sealed Vault fails here and alert.sh reports that.
# Explicit PATH: cron on this host has none worth having (Ubuntu cron takes PATH
# from PAM and /etc/environment holds only LC_ALL), the same cause that broke offsite.sh.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
T=$(grep '^VAULT_TOKEN=' /opt/snap-apps/deploy/.env | cut -d= -f2-)
docker exec snap-apps-vault-1 wget -qO- --header="X-Vault-Token:$T" --post-data='' \
  http://127.0.0.1:8200/v1/auth/token/renew-self >/dev/null 2>&1 \
  && echo "[$(date -u +%FT%TZ)] vault token renewed" || { echo "[$(date -u +%FT%TZ)] vault token renew FAILED" >&2; exit 1; }
