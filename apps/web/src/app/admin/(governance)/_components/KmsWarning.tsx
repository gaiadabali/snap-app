import { Card } from '@/design/primitives';

/**
 * Operational warning for every screen that manages an AI provider key.
 *
 * `apps/server/src/admin/crypto/kms.ts` is explicit in its own header: there
 * is no cloud KMS wired into this repo yet. The "KMS" wrapping every stored
 * key's DEK is a master key read from an environment variable
 * (`ADMIN_KMS_MASTER_KEY`) — envelope encryption, correctly shaped, but the
 * KEK itself is a local secret rather than AWS/GCP KMS or Vault. An operator
 * setting a real provider key here should know that before they do it.
 */
export function KmsWarning() {
  return (
    <Card tone="ground" className="border-[var(--color-warn)]">
      <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        <strong className="text-[var(--color-warn)]">Operational warning:</strong> keys set here are
        encrypted with envelope encryption (AES-256-GCM, a per-key DEK wrapped by a master key), but the
        master key is currently a local stand-in read from an environment variable — <em>not</em> a real
        cloud KMS (AWS KMS, GCP KMS, Vault). See <code>apps/server/src/admin/crypto/kms.ts</code>. Treat any
        key set while this is true as protected by encryption-at-rest, not by a hardware-backed key
        boundary — replacing the stand-in is an operational requirement before this holds production
        provider keys.
      </p>
    </Card>
  );
}
