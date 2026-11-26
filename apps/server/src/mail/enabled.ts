import { config } from '../config.js';
import { oidcClientConfigured } from '../yourtal/oidc-client-api.js';

/**
 * Whether Spambank mail is on in this deployment (spambank/BUILD.md §4.12):
 * `SPAMBANK_ENABLED` (unset = on, owner answer Q6) AND SnapApp's YourTal server
 * client is configured, because every mail call is made with that client's
 * credentials. Either missing and the mail entries stay hidden:
 * `/v1/mail/status` says `available: false` and the rest answer 404.
 */
export function mailAvailable(): boolean {
  return config().SPAMBANK_ENABLED && oidcClientConfigured();
}
