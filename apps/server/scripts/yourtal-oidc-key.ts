/**
 * The website client's key for Sign in with YourTal (`private_key_jwt`).
 *
 *   pnpm --filter @snap/server yourtal:oidc-key new <private-key-file>
 *       Makes a new RS256 key (RSA 2048), writes the PRIVATE JWK to the file
 *       (mode 0600; refuses to overwrite one), and prints the PUBLIC JWK to
 *       register at YourTal for snapapp-staging-web. `kid` is the RFC 7638
 *       thumbprint of the public key.
 *
 *   pnpm --filter @snap/server yourtal:oidc-key public <private-key-file>
 *       Prints the PUBLIC JWK of an existing key file (a private JWK, or an
 *       RSA PKCS#8 PEM made with
 *       `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`).
 *
 * The private key is never printed. It goes on the host as
 * /etc/snap-apps/secrets/yourtal-oidc-web.jwk (mode 0600, owner uid 1001) and
 * nowhere else: not this repo, not deploy/.env, not a chat. See
 * deploy/.env.example, "Sign in with YourTal".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

import { parsePrivateKey, publicHalf } from '../src/auth/yourtal-signin/settings.js';

const [command, file] = process.argv.slice(2);

function usage(): never {
  console.error('usage: yourtal-oidc-key (new|public) <private-key-file>');
  process.exit(2);
}

if (!file || (command !== 'new' && command !== 'public')) usage();

if (command === 'new') {
  if (existsSync(file)) {
    console.error(`${file} already exists; refusing to overwrite a key. Move it away first.`);
    process.exit(1);
  }
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const jwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(publicHalf(jwk));
  writeFileSync(file, `${JSON.stringify({ ...jwk, kid, alg: 'RS256', use: 'sig' })}\n`, { mode: 0o600, flag: 'wx' });
  console.error(`wrote the PRIVATE key to ${file} (mode 0600). Keep it secret; copy it only to the host.`);
}

const key = await parsePrivateKey(readFileSync(file, 'utf8').trim());
console.error('PUBLIC JWK to register at YourTal for the website client (safe to share):');
console.log(JSON.stringify(key.publicJwk, null, 2));
