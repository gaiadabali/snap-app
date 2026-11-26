# @snap/mail-engine

The shared Spambank mail engine: one TypeScript client that talks JMAP to the
YourTal mail proxy with a 30-minute **mail token**, for Next (web) and Expo React
Native. Contract: `spambank/BUILD.md` §5.3 (proxy) and §5.7 (this API).

**This is the source of truth.** YourTal (`packages/mail-engine/src`) and Free Tax
Returns (`src/mail-engine`) carry byte-for-byte copies of `src/`. Change the engine
only here, merge, then run the sync script for each consumer.

```
node scripts/sync-mail-engine.mjs <consumer-dir>           # copy src/ (LF endings), print the snap-app commit
node scripts/sync-mail-engine.mjs --check <consumer-dir>   # exit 1 if the copy differs (for the consumers' CI)
```

## Use

```ts
import { createMailClient, toSandboxDocument, IFRAME_SANDBOX } from "@snap/mail-engine";
import { MailProvider, useFolders, useMessageList } from "@snap/mail-engine/react";
import { createMemoryMailClient } from "@snap/mail-engine/testing"; // UI work before the proxy is live

const client = createMailClient({
  // The app's own backend mints the token (POST /api/spambank/me/session, or the
  // client-credentials call for SnapApp and FTR). The engine refreshes 2 minutes
  // before expiry and once on a 401.
  getSession: () => fetch("/api/mail/session", { method: "POST" }).then((r) => r.json()),
});
```

- **Web:** render a message with `<iframe sandbox={IFRAME_SANDBOX} srcDoc={doc} />` where
  `doc = toSandboxDocument(await client.safeHtml(id))` (or the `useSandboxDocument` hook).
  There is no `allow-scripts`, and remote images are stripped by the server.
- **Android:** pass `downloadToUri` (stream a download to a file; the headers carry the
  token) and render the same document in a `react-native-webview` with JavaScript off.
  `fetch` cannot stream there, so `push: "auto"` polls every 30 s.
- **Tests:** `createMemoryMailClient()` has ~20 fixture messages and behaves like the real
  client (`test/contract.ts` runs one behavioural suite against both).

## Rules for everything under `src/`

These keep the same files working in three repos and on a phone (`test/portability.test.ts`
enforces them):

- no DOM, React Native or Node imports at module load; no Node built-ins;
- relative imports without an extension (Metro resolves `.js` literally);
- no workspace (`@snap/*`) imports and no runtime dependencies; `react` is an optional peer
  used only by `src/react.ts`;
- the token only ever travels in an `Authorization` header, never in a URL;
- it must typecheck under YourTal's flags: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`,
  `isolatedModules`, `moduleResolution: bundler` (see `tsconfig.json`; the `DOM` lib is
  needed for the `fetch`, `Blob` and `AbortController` types).

## Layout

| Path | What |
|---|---|
| `src/index.ts`, `src/react.ts`, `src/testing.ts` | the three entry points |
| `src/model.ts` | public types, `MailError` |
| `src/jmap/transport.ts` | token lifecycle, authenticated fetch, JMAP calls, error mapping |
| `src/ops/*` | folders, messages, send/upload/download, compose helpers, proxy helper routes |
| `src/push/*` | fetch-based SSE reader and the poll fallback |
| `src/state/stores.ts` | framework-free stores behind the hooks |
| `src/html.ts` | `toSandboxDocument`, `IFRAME_SANDBOX`, `MAIL_CSP` |
| `src/testing/*` | in-memory client and fixtures |
| `test/` | tests, the fake proxy (`fake-proxy.ts`) and the shared contract suite |
| `smoke/smoke.ts` | live smoke test: `pnpm --filter @snap/mail-engine smoke` with a staging token |

## Folders

`FolderKey` `spam` is the server's `junk`-role mailbox (the spam filter); `junk` is the
custom mailbox the Sieve rule fills with bulk mail. Its id comes from the proxy's
`/summary` (`folders.junkMailboxId`), falling back to a role-less mailbox named `Junk` or
`Promotions`. UIs label folders from their own strings, never from server names.
