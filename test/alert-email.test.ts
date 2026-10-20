import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The alert email channel of deploy/monitor/alert.sh (task 1.14). The real
 * script runs against a scratch directory with a fake `uptime.sh` (so no
 * network) and a fake `curl` that records its argv and stdin, so nothing is
 * sent. They need bash, base64 and fold, which the Linux CI runner has.
 */
vi.setConfig({ testTimeout: 120_000 });
const SRC = join(import.meta.dirname, '..', 'deploy', 'monitor', 'alert.sh');
const root = mkdtempSync(join(tmpdir(), 'alert-email-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** `C:\a\b` -> `/c/a/b` for Git Bash on a developer's Windows machine; identity elsewhere. */
const posix = (p: string) => p.replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, '/');

const KEY = 're_SECRETKEY_0123456789';
const SMTP_URL = `smtp://resend:${KEY}@smtp.resend.com:587`;
const FROM = 'Snap Apps <no-reply@freetaxreturns.com.au>';

// The script under test sits beside a fake uptime.sh that reports what the test says.
const SCRIPT_DIR = join(root, 'monitor');
mkdirSync(SCRIPT_DIR);
copyFileSync(SRC, join(SCRIPT_DIR, 'alert.sh'));
writeFileSync(join(SCRIPT_DIR, 'uptime.sh'), `#!/usr/bin/env bash\ncat "$FAKE_UPTIME_OUT"\n[ -z "$(grep ^FAILED "$FAKE_UPTIME_OUT")" ]\n`);
chmodSync(join(SCRIPT_DIR, 'uptime.sh'), 0o755);

// Fake curl: one argv entry per line, stdin, and the uploaded message, all appended per call.
const BIN = join(root, 'bin');
mkdirSync(BIN);
writeFileSync(
  join(BIN, 'curl'),
  `#!/usr/bin/env bash
n=$(( $(cat "$FAKE_DIR/count" 2>/dev/null || echo 0) + 1 )); echo $n > "$FAKE_DIR/count"
printf '%s\\n' "$@" > "$FAKE_DIR/argv.$n"
cat > "$FAKE_DIR/stdin.$n"
prev=""; for a in "$@"; do
  [ "$prev" = "-T" ] && cp "$a" "$FAKE_DIR/message.$n"
  prev="$a"
done
if [ -f "$FAKE_DIR/fail" ]; then echo "curl: (67) Login denied" >&2; exit 67; fi
exit 0
`,
);
chmodSync(join(BIN, 'curl'), 0o755);

let dir: string; // per-test scratch: fake dir, state dir, env files
const p = (...a: string[]) => posix(join(dir, ...a));
const setUptime = (lines: string[]) => writeFileSync(join(dir, 'uptime.out'), lines.join('\n') + '\n');

beforeEach(() => {
  dir = mkdtempSync(join(root, 't-'));
  mkdirSync(join(dir, 'fake'));
  mkdirSync(join(dir, 'state'));
  setUptime(['all good']);
});

function run(args: string[] = [], env: Record<string, string | undefined> = {}) {
  const e: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${posix(BIN)}${delimiter}${process.env.PATH}`,
    FAKE_DIR: p('fake'),
    FAKE_UPTIME_OUT: p('uptime.out'),
    ALERT_STATE_DIR: p('state'),
    ALERT_ENV_FILE: p('no-such-alert.env'),
    SNAP_DEPLOY_ENV: p('no-such-deploy.env'),
    ALERT_EMAIL_TO: 'hansel@gaiada.com,web@gaiada.com',
    SMTP_URL,
    MAIL_FROM: FROM,
    ALERT_WEBHOOK_URL: undefined,
    ...env,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const r = spawnSync('bash', [posix(join(SCRIPT_DIR, 'alert.sh')), ...args], { encoding: 'utf8', env: e as NodeJS.ProcessEnv });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const calls = () => Number(existsSync(join(dir, 'fake', 'count')) ? readFileSync(join(dir, 'fake', 'count'), 'utf8') : 0);
const argv = (n: number) => readFileSync(join(dir, 'fake', `argv.${n}`), 'utf8').split('\n');
const stdin = (n: number) => readFileSync(join(dir, 'fake', `stdin.${n}`), 'utf8');
/** The sent message, with its base64 body decoded, so assertions read plain text. */
const message = (n: number) => {
  const raw = readFileSync(join(dir, 'fake', `message.${n}`), 'utf8');
  const [head, ...rest] = raw.split('\r\n\r\n');
  const body = Buffer.from(rest.join('').replace(/\s+/g, ''), 'base64').toString('utf8');
  return { head, body };
};
const state = () => (existsSync(join(dir, 'state', 'last-state')) ? readFileSync(join(dir, 'state', 'last-state'), 'utf8').trim() : null);

const FAILING = ['FAILED unreachable: https://snap-apps-api.gaiada.com/v1/ready', 'checked something else'];

describe('alert.sh email channel', () => {
  it('sends one email on the flip to failing, to every recipient, over required TLS', () => {
    setUptime(FAILING);
    const r = run();
    expect(r.code).toBe(1);
    expect(calls()).toBe(1);
    const a = argv(1);
    expect(a).toContain('--ssl-reqd');
    expect(a).toContain('smtp://smtp.resend.com:587');
    expect(a).toContain('no-reply@freetaxreturns.com.au'); // the envelope sender, without the display name
    expect(a.filter((x) => x === '--mail-rcpt').length).toBe(2);
    expect(a).toContain('hansel@gaiada.com');
    expect(a).toContain('web@gaiada.com');
    const m = message(1);
    expect(m.head).toContain(`From: ${FROM}`);
    expect(m.head).toContain('Subject: [snap-apps ALERT] FAILED unreachable: https://snap-apps-api.gaiada.com/v1/ready');
    expect(m.body).toContain('FAILING:\nFAILED unreachable');
    expect(m.body).toContain('OK:\nchecked something else');
    expect(m.body).toMatch(/Host: \S+/);
    expect(m.body).toMatch(/Time: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
    expect(state()).toBe('failing');
  });

  it('sends nothing while it is still failing', () => {
    setUptime(FAILING);
    run();
    expect(run().code).toBe(1);
    expect(run().code).toBe(1);
    expect(calls()).toBe(1);
  });

  it('sends nothing while healthy, and one RECOVERED email on the flip back', () => {
    expect(run().code).toBe(0);
    expect(calls()).toBe(0);
    setUptime(FAILING);
    run();
    setUptime(['all good']);
    const r = run();
    expect(r.code).toBe(0);
    expect(calls()).toBe(2);
    const m = message(2);
    expect(m.head).toContain('Subject: [snap-apps RECOVERED] all checks OK');
    expect(m.body).toContain('OK:\nall good');
    expect(state()).toBe('ok');
    run(); // still healthy: no further mail
    expect(calls()).toBe(2);
  });

  it('keeps the credentials out of argv, the message and the log; they travel on stdin', () => {
    setUptime(FAILING);
    const r = run();
    expect(argv(1).join('\n')).not.toContain(KEY);
    expect(argv(1).join('\n')).not.toContain('resend:');
    expect(argv(1)).toContain('-K'); // config from stdin
    expect(argv(1)[argv(1).indexOf('-K') + 1]).toBe('-');
    expect(stdin(1)).toBe(`user = "resend:${KEY}"\n`);
    expect(readFileSync(join(dir, 'fake', 'message.1'), 'utf8')).not.toContain(KEY);
    expect(r.out).not.toContain(KEY);
  });

  it('keeps the credentials out of the log when the send fails, and still exits as before', () => {
    writeFileSync(join(dir, 'fake', 'fail'), '');
    setUptime(FAILING);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/warning: alert email not sent \(curl exit 67\)/);
    expect(r.out).not.toContain(KEY);
    expect(state()).toBe('failing');
    // A failed recovery email does not break the healthy run either.
    setUptime(['all good']);
    const ok = run();
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/warning: alert email not sent/);
    expect(state()).toBe('ok');
  });

  it('reads ALERT_EMAIL_TO, SMTP_URL and MAIL_FROM from the files by key, never sourcing them', () => {
    writeFileSync(join(dir, 'alert.env'), 'ALERT_EMAIL_TO=a@x.test, b@x.test\n');
    writeFileSync(
      join(dir, 'deploy.env'),
      [
        `touch ${p('sourced')}`, // would run if the file were sourced
        'OTHER=$(touch ' + p('sourced') + ')',
        `SMTP_URL=smtp://resend:p%40ss@smtp.example.test:2525`,
        `MAIL_FROM="${FROM}"`,
        '',
      ].join('\n'),
    );
    setUptime(FAILING);
    const r = run([], {
      ALERT_EMAIL_TO: undefined,
      SMTP_URL: undefined,
      MAIL_FROM: undefined,
      ALERT_ENV_FILE: p('alert.env'),
      SNAP_DEPLOY_ENV: p('deploy.env'),
    });
    expect(r.code).toBe(1);
    expect(existsSync(join(dir, 'sourced'))).toBe(false);
    expect(calls()).toBe(1);
    expect(argv(1)).toContain('smtp://smtp.example.test:2525');
    expect(argv(1)).toContain('a@x.test');
    expect(argv(1)).toContain('b@x.test');
    expect(argv(1)).toContain('no-reply@freetaxreturns.com.au');
    expect(stdin(1)).toBe('user = "resend:p@ss"\n'); // percent-decoded
  });

  it('with no ALERT_EMAIL_TO sends nothing and the checks still run', () => {
    setUptime(FAILING);
    const r = run([], { ALERT_EMAIL_TO: undefined });
    expect(r.code).toBe(1);
    expect(calls()).toBe(0);
    expect(r.out).toContain('FAILED unreachable'); // the summary still prints
    expect(state()).toBe('failing');
    setUptime(['all good']);
    expect(run([], { ALERT_EMAIL_TO: undefined }).code).toBe(0);
    expect(calls()).toBe(0);
  });

  it('with recipients but no SMTP login, warns and carries on', () => {
    setUptime(FAILING);
    const r = run([], { SMTP_URL: undefined });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/warning: alert email not sent: SMTP_URL/);
    expect(calls()).toBe(0);
  });

  it('still posts the webhook on the flip when it is set, alongside the email', () => {
    setUptime(FAILING);
    run([], { ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' });
    expect(calls()).toBe(2);
    const urls = [1, 2].map((n) => argv(n).join(' '));
    expect(urls.some((u) => u.includes('https://hooks.example.test/x'))).toBe(true);
    expect(urls.some((u) => u.includes('smtp://smtp.resend.com:587'))).toBe(true);
  });
});

describe('alert.sh --test-alert', () => {
  it('sends one labelled test email through the same path and leaves the state alone', () => {
    writeFileSync(join(dir, 'state', 'last-state'), 'failing\n');
    const r = run(['--test-alert']);
    expect(r.code).toBe(0);
    expect(calls()).toBe(1);
    const m = message(1);
    expect(m.head).toContain('Subject: [snap-apps TEST] alert email delivery check');
    expect(m.body).toContain('TEST');
    expect(m.body).toContain('Nothing is wrong');
    expect(argv(1)).toContain('--ssl-reqd');
    expect(argv(1).join('\n')).not.toContain(KEY);
    expect(stdin(1)).toBe(`user = "resend:${KEY}"\n`);
    expect(readFileSync(join(dir, 'state', 'last-state'), 'utf8').trim()).toBe('failing');
  });

  it('does not create a state file, and does not run the checks', () => {
    setUptime(FAILING); // would fail if the checks ran
    const r = run(['--test-alert']);
    expect(r.code).toBe(0);
    expect(state()).toBeNull();
    expect(calls()).toBe(1);
  });

  it('exits 1 with a clear message when there are no recipients or the send fails', () => {
    const none = run(['--test-alert'], { ALERT_EMAIL_TO: undefined });
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/no recipients/);
    expect(calls()).toBe(0);
    writeFileSync(join(dir, 'fake', 'fail'), '');
    const bad = run(['--test-alert']);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/could not be sent/);
    expect(bad.out).not.toContain(KEY);
  });
});
