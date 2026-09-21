# Vault server configuration — docs/INTEGRATIONS.md Lane K, ticket K3.
#
# NOT dev mode. `vault server -dev` keeps everything in memory and unseals
# itself with a root token printed to the log: every credential wrapped by it
# is lost on restart and the token is in `docker logs`. It is the right thing
# for the in-process simulator (which is not this) and never for a host that
# stores a real key.

# File storage, on the `vault_data` volume.
#
# Not Postgres, deliberately, even though there is a Postgres right there.
# The KMS protecting the database's secrets should not depend on that same
# database being up — a single failure would then take out both the data and
# the ability to read it. File storage keeps the blast radius to one
# container.
storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  # 0.0.0.0 inside the container only. The compose service publishes NO
  # ports, so the only route here is a hop from another container on
  # snap-internal.
  address = "0.0.0.0:8200"

  # Plaintext HTTP on a private bridge network, and this is a deliberate
  # decision rather than an oversight.
  #
  # The traffic never leaves the Docker bridge — no port is published, and
  # delphi's ufw allowlist does not reach it. TLS here would mean generating
  # and rotating an internal CA whose private key would live on the same disk
  # as Vault's own storage, protecting a hop that does not leave the host.
  # That is more moving parts guarding the same trust boundary.
  #
  # WHAT WOULD CHANGE THIS: the moment Vault serves anything off this box —
  # a second host, a different VPS, anything crossing a network — this must
  # become TLS with a real certificate. The line below is load-bearing for
  # that decision and should be read before moving the service.
  tls_disable = 1
}

# Mlock keeps key material out of swap. The compose service grants IPC_LOCK
# so this succeeds; if it ever starts failing, Vault says so at boot and that
# warning must not be ignored.
disable_mlock = false

# Vault answers its own address on loopback for the healthcheck.
api_addr = "http://127.0.0.1:8200"

ui = false
