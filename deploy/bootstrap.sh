#!/usr/bin/env bash
# Snap Apps — first-time VPS setup ("delphi").
#
# Run ONCE, as root, on a fresh Debian 12 / Ubuntu 22.04+ box. Idempotent
# where it reasonably can be (re-running does not duplicate firewall rules or
# re-create an existing user), but this is bootstrap, not deploy.sh — it is
# meant to be read before it is run, not blindly re-invoked.
#
#   ssh root@delphi 'bash -s' < deploy/bootstrap.sh
#
# What it does, in order:
#   1. Installs Docker Engine + compose plugin (official get.docker.com script).
#   2. Installs Node 20 (NodeSource) — needed on the HOST, not in a container,
#      because packages/db/scripts/db.mjs (which deploy.sh calls to run
#      migrations and create snap_app/snap_worker) shells out to
#      `docker exec <container> psql`. It has no npm dependencies of its own,
#      so a bare Node 20 binary is enough; no `pnpm install` on the host.
#   3. Creates a non-root `snapapps` system user, adds it to the `docker`
#      group, and creates the data/backup directories it owns.
#   4. Firewall: ufw, default-deny incoming, allow only 22 (ssh), 80, 443.
#   5. Installs the nightly backup cron job (deploy/backup.sh) under the
#      snapapps user's crontab.
#
# Does NOT: clone the repo, write deploy/.env, or start any container — that
# is deploy.sh's job, run afterwards as the snapapps user.

set -euo pipefail

APP_USER="${SNAP_APP_USER:-snapapps}"
APP_HOME="/opt/snap-apps"
BACKUP_DIR="/opt/snap-apps/backups"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap.sh must run as root (it installs packages and configures ufw)." >&2
  exit 1
fi

echo "==> [1/5] Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "    already installed: $(docker --version)"
fi
systemctl enable --now docker

echo "==> [2/5] Node 20 (host-side only — runs packages/db/scripts/db.mjs, nothing else)"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "    already installed: $(node --version)"
fi

echo "==> [3/5] snapapps user + data directories"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
fi
usermod -aG docker "${APP_USER}"

mkdir -p "${APP_HOME}" /opt/snap-apps/data/storage /etc/snap-apps/secrets "${BACKUP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}" /etc/snap-apps/secrets "${BACKUP_DIR}"
chmod 700 /etc/snap-apps/secrets
echo "    ${APP_HOME} is where the repo should be cloned (as ${APP_USER})"
echo "    /etc/snap-apps/secrets/ollama.env holds the Ollama key — put it there, chmod 600, before first deploy"

echo "==> [4/5] Firewall (ufw): 22, 80, 443 only"
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status verbose
else
  echo "    ufw not found — installing"
  apt-get update && apt-get install -y ufw
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "==> [5/5] Nightly backup cron (03:15 local time, as ${APP_USER})"
CRON_LINE="15 3 * * * ${APP_HOME}/deploy/backup.sh >> ${BACKUP_DIR}/backup.log 2>&1"
( crontab -u "${APP_USER}" -l 2>/dev/null | grep -vF "deploy/backup.sh" ; echo "${CRON_LINE}" ) \
  | crontab -u "${APP_USER}" -

cat <<'EOF'

==> Bootstrap done. Remaining manual steps, as the snapapps user:
    1. git clone <this repo> /opt/snap-apps      (or rsync it up)
    2. cp deploy/.env.example deploy/.env  &&  fill it in (see docs/DEPLOY.md §9)
    3. put the production Ollama key at /etc/snap-apps/secrets/ollama.env, chmod 600
    4. point your temporary domain's DNS A record at this host
    5. run deploy/deploy.sh
EOF
