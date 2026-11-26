/**
 * Live smoke test against a real mail proxy (spambank/BUILD.md T10 done-when 5).
 * Run by QA with a staging mail token:
 *
 *   MAIL_SMOKE_TOKEN=sbm1.… \
 *   MAIL_SMOKE_ADDRESS=geewizduck@yourtal.gaiada.com \
 *   MAIL_SMOKE_SESSION_URL=https://yourtal.gaiada.com/api/spambank/jmap/session \
 *   MAIL_SMOKE_HELPERS_BASE=https://yourtal.gaiada.com/api/spambank/mail \
 *   pnpm --filter @snap/mail-engine smoke
 *
 * Mint the token with POST /api/spambank/me/session (it also returns sessionUrl,
 * helpersBase and address). The token is read from the environment, never from a file
 * and never printed. The test lists the folders, sends one mail to the mailbox itself,
 * sees it arrive through onChange (the proxied EventSource), finds it by search and
 * cleans up after itself.
 */
import { MailError, createMailClient } from "../src/index";
import type { MailSession } from "../src/index";

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing environment variable ${name}`);
    process.exit(2);
  }
  return value;
}

const token = need("MAIL_SMOKE_TOKEN");
const address = need("MAIL_SMOKE_ADDRESS");
const sessionUrl = need("MAIL_SMOKE_SESSION_URL");
const helpersBase = need("MAIL_SMOKE_HELPERS_BASE");
const push = process.env["MAIL_SMOKE_PUSH"] === "poll" ? "poll" : "sse";

const session: MailSession = {
  token,
  // A minted token lives 30 minutes; the smoke test needs far less.
  expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  sessionUrl,
  helpersBase,
  address,
};

function step(name: string, detail: string): void {
  console.log(`ok  ${name}: ${detail}`);
}

async function main(): Promise<void> {
  const client = createMailClient({ getSession: async () => session, push, pollMs: 2000 });
  try {
    const folders = await client.folders();
    step("folders", folders.map((f) => `${f.key}(${f.unread}/${f.total})`).join(" "));
    if (folders.length < 6) throw new Error(`expected 6 folders, got ${folders.length}`);

    let changed = false;
    const off = client.onChange((what) => {
      if (what.messages) changed = true;
    });
    // Let the event stream connect before sending.
    await new Promise((r) => setTimeout(r, 1500));

    const subject = `engine smoke ${new Date().toISOString()}`;
    const sent = await client.send({ to: [{ email: address }], subject, text: "mail engine smoke test" });
    step("send", `submitted ${sent.emailId}`);

    const deadline = Date.now() + 30_000;
    while (!changed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (!changed) throw new Error(`no change notification within 30 s (push=${push})`);
    step("onChange", `notified (${push})`);
    off();

    let hit = (await client.search(subject)).items.find((m) => m.folder === "inbox");
    for (let i = 0; !hit && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      hit = (await client.search(subject)).items.find((m) => m.folder === "inbox");
    }
    if (!hit) throw new Error("the message never reached the Inbox");
    step("arrival", `inbox message ${hit.id}`);

    const detail = await client.get(hit.id);
    if (!detail.text?.includes("smoke test")) throw new Error("body did not round-trip");
    step("get", `text ${JSON.stringify(detail.text.slice(0, 30))}`);

    // Clean up: the copy in the Inbox and the one in Sent go to Trash, then are destroyed.
    const sentCopy = (await client.search(subject)).items.filter((m) => m.id !== hit.id).map((m) => m.id);
    await client.remove([hit.id, ...sentCopy]);
    await client.remove([hit.id, ...sentCopy]);
    step("cleanup", "removed");
    console.log("SMOKE PASSED");
  } finally {
    client.close();
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    const detail = e instanceof MailError ? `${e.code}${e.status ? ` (HTTP ${e.status})` : ""}: ${e.message}` : String(e);
    console.error(`FAIL ${detail}`);
    process.exit(1);
  },
);
