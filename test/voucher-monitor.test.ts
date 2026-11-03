import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The YourTal voucher check of deploy/monitor/alert.sh --inbox (plan 2.8, S7).
 * `docker` is faked: `exec` prints a canned psql row and records argv + the SQL
 * on stdin. The SQL itself was run against a real migrated Postgres by hand
 * (see the S7 report); here we pin the row parsing, the verdicts and that the
 * session is read-only.
 */
vi.setConfig({ testTimeout: 60_000 });
const SRC = join(import.meta.dirname, "..", "deploy", "monitor", "alert.sh");
const root = mkdtempSync(join(tmpdir(), "voucher-monitor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const posix = (p: string) =>
  p
    .replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");

const SCRIPT_DIR = join(root, "monitor");
mkdirSync(SCRIPT_DIR);
copyFileSync(SRC, join(SCRIPT_DIR, "alert.sh"));
writeFileSync(join(SCRIPT_DIR, "uptime.sh"), "#!/usr/bin/env bash\nexit 0\n");
chmodSync(join(SCRIPT_DIR, "uptime.sh"), 0o755);

const BIN = join(root, "bin");
mkdirSync(BIN);
writeFileSync(
  join(BIN, "docker"),
  `#!/usr/bin/env bash
if [ "$1" = exec ]; then
  printf '%s\\n' "$@" > "$FAKE_DIR/argv"; cat > "$FAKE_DIR/sql"
  [ -f "$FAKE_DIR/rc" ] && { cat "$FAKE_DIR/out"; exit "$(cat "$FAKE_DIR/rc")"; }
  cat "$FAKE_DIR/out"; exit 0
fi
exit 1
`,
);
chmodSync(join(BIN, "docker"), 0o755);

function run(out: string, rc?: number) {
  const dir = mkdtempSync(join(root, "t-"));
  writeFileSync(join(dir, "out"), out + "\n");
  if (rc !== undefined) writeFileSync(join(dir, "rc"), String(rc));
  const env = {
    ...process.env,
    PATH: `${posix(BIN)}${delimiter}${process.env.PATH}`,
    FAKE_DIR: posix(dir),
    ALERT_STATE_DIR: posix(join(dir, "state")),
    ALERT_ENV_FILE: posix(join(dir, "none")),
    SNAP_DEPLOY_ENV: posix(join(dir, "none")),
    ALERT_EMAIL_TO: "",
  } as NodeJS.ProcessEnv;
  const r = spawnSync(
    "bash",
    [posix(join(SCRIPT_DIR, "alert.sh")), "--inbox"],
    { encoding: "utf8", env },
  );
  const line =
    `${r.stdout}${r.stderr}`.split("\n").find((l) => l.includes("vouchers:")) ??
    "";
  return {
    line,
    argv: readFileSync(join(dir, "argv"), "utf8"),
    sql: readFileSync(join(dir, "sql"), "utf8"),
  };
}

describe("alert.sh voucher check", () => {
  it("is OK when every count is zero, and asks read-only, as postgres, for counts only", () => {
    const r = run("0 0 0 0");
    expect(r.line).toBe("vouchers: no stuck redemptions");
    expect(r.argv).toContain("default_transaction_read_only=on");
    expect(r.sql).toMatch(/^SELECT/);
    expect(r.sql).not.toMatch(/code_sha256|UPDATE|DELETE|INSERT/i);
    for (const s of [
      "needs_review",
      "captured",
      "authorization_mismatch",
      "'granted','voided','expired','refused','abandoned','failed'",
    ]) {
      expect(r.sql).toContain(s);
    }
  });

  it.each([
    [
      "1 0 0 0",
      "needs_review=1 captured_no_grant=0 unfinished_over_1h=0 authorization_mismatch=0",
    ],
    ["0 2 0 0", "captured_no_grant=2"],
    ["0 0 3 0", "unfinished_over_1h=3"],
    ["0 0 0 1", "authorization_mismatch=1"],
  ])("flags %s", (out, want) => {
    const r = run(out);
    expect(r.line).toContain("vouchers: needs_review=");
    expect(r.line).toContain(want);
  });

  it("flags a failed or garbled query instead of passing it", () => {
    expect(run("psql: error: connection refused", 2).line).toContain(
      "vouchers: query failed: psql: error",
    );
    expect(
      run('ERROR: relation "yourtal_voucher_redemptions" does not exist', 3)
        .line,
    ).toContain("query failed");
    expect(run("garbage").line).toContain("query failed");
  });
});
