import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The uptime and nginx checks of deploy/monitor/alert.sh --inbox. `curl`,
 * `nginx` and `docker` are faked: curl answers FAKE_BAD_URL with 503 and every
 * other URL with 200; nginx -t exits with FAKE_NGINX_RC.
 */
vi.setConfig({ testTimeout: 60_000 });
const SRC = join(import.meta.dirname, "..", "deploy", "monitor", "alert.sh");
const root = mkdtempSync(join(tmpdir(), "uptime-monitor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const posix = (p: string) =>
  p.replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, "/");

const SCRIPT_DIR = join(root, "monitor");
mkdirSync(SCRIPT_DIR);
copyFileSync(SRC, join(SCRIPT_DIR, "alert.sh"));
writeFileSync(join(SCRIPT_DIR, "uptime.sh"), "#!/usr/bin/env bash\nexit 0\n");
chmodSync(join(SCRIPT_DIR, "uptime.sh"), 0o755);

function fake(dir: string, name: string, body: string) {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

function run(env: Record<string, string>, withNginx = true) {
  const dir = mkdtempSync(join(root, "t-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  fake(bin, "curl", `for a in "$@"; do u=$a; done
if [ "$u" = "$FAKE_BAD_URL" ]; then printf 503; exit 0; fi
if [ "$u" = "$FAKE_DOWN_URL" ]; then exit 7; fi
printf 200`);
  fake(bin, "docker", "echo '0 0 0 0'");
  if (withNginx) {
    fake(bin, "nginx", `if [ "$FAKE_NGINX_RC" != 0 ]; then
  echo 'nginx: [emerg] cannot load certificate "/etc/ssl/x.pem" in /etc/nginx/vhost.conf:3' >&2
  echo 'nginx: configuration file /etc/nginx/nginx.conf test failed' >&2; exit 1; fi
echo 'syntax is ok' >&2`);
  }
  const r = spawnSync("bash", [posix(join(SCRIPT_DIR, "alert.sh")), "--inbox"], {
    encoding: "utf8",
    env: {
      ...process.env,
      // minimal PATH after the fakes keeps a real nginx off the test
      PATH: `${posix(bin)}${delimiter}${process.env.PATH}`,
      ALERT_STATE_DIR: posix(join(dir, "state")),
      ALERT_ENV_FILE: posix(join(dir, "none")),
      SNAP_DEPLOY_ENV: posix(join(dir, "none")),
      ALERT_EMAIL_TO: "",
      FAKE_NGINX_RC: "0",
      ...env,
    } as NodeJS.ProcessEnv,
  });
  return `${r.stdout}${r.stderr}`.split("\n");
}
const pick = (lines: string[], k: string) => lines.filter((l) => l.includes(k));

describe("alert.sh uptime check", () => {
  it("is OK for each URL when all answer 200", () => {
    const l = pick(run({}), "uptime:");
    expect(l).toHaveLength(3);
    expect(l.every((x) => x.startsWith("uptime: ") && x.includes("answered 200"))).toBe(true);
  });
  it("FAILS naming the URL on a 503 and on an unreachable host", () => {
    const l = run({
      FAKE_BAD_URL: "https://yourtal.gaiada.com/",
      FAKE_DOWN_URL: "https://freetaxreturns.com.au/api/health",
    });
    expect(l).toContain("uptime: https://yourtal.gaiada.com/ answered 503 (000 = unreachable)");
    expect(l.some((x) => x.startsWith("uptime: https://freetaxreturns.com.au/api/health answered 000"))).toBe(true);
  });
  it("UPTIME_CHECK=off skips", () => {
    expect(pick(run({ UPTIME_CHECK: "off" }), "uptime:")).toHaveLength(0);
  });
});

describe("alert.sh nginx_config check", () => {
  it("is OK when nginx -t passes", () => {
    expect(pick(run({}), "nginx_config:")).toEqual(["nginx_config: nginx -t passes"]);
  });
  it("FAILS with the error line when nginx -t fails", () => {
    const l = pick(run({ FAKE_NGINX_RC: "1" }), "nginx_config:");
    expect(l[0]).toContain("nginx -t failed: nginx: [emerg] cannot load certificate");
  });
  it("NGINX_CHECK=off skips", () => {
    expect(pick(run({ FAKE_NGINX_RC: "1", NGINX_CHECK: "off" }), "nginx_config:")).toHaveLength(0);
  });
});
