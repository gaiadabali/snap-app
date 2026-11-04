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
 * The YourTal deletion-jobs check of deploy/monitor/alert.sh --inbox (group
 * 3.7, S2). `docker` is faked: the `exec` whose SQL reads `jobs` prints a
 * canned psql row and records argv + SQL; other checks' execs get zeros. The
 * SQL itself was run against a real migrated Postgres by hand (S2 report).
 */
vi.setConfig({ testTimeout: 60_000 });
const SRC = join(import.meta.dirname, "..", "deploy", "monitor", "alert.sh");
const root = mkdtempSync(join(tmpdir(), "erasure-monitor-"));
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
  sql=$(cat)
  case "$sql" in *"FROM jobs"*) ;; *) echo "0 0 0 0"; exit 0 ;; esac
  printf '%s\\n' "$@" > "$FAKE_DIR/argv"; printf '%s' "$sql" > "$FAKE_DIR/sql"
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
    `${r.stdout}${r.stderr}`.split("\n").find((l) => l.includes("erasure:")) ??
    "";
  return {
    line,
    argv: readFileSync(join(dir, "argv"), "utf8"),
    sql: readFileSync(join(dir, "sql"), "utf8"),
  };
}

describe("alert.sh erasure check", () => {
  it("is OK when nothing is stuck, and asks read-only, as postgres, for counts only", () => {
    const r = run("0 0 0 0");
    expect(r.line).toBe("erasure: no stuck deletion jobs");
    expect(r.argv).toContain("default_transaction_read_only=on");
    expect(r.argv).toContain("postgres");
    expect(r.sql).toMatch(/^SELECT/);
    expect(r.sql).not.toMatch(/payload|UPDATE|DELETE|INSERT/i);
    for (const s of ["'yourtal_event'", "'storage_purge'", "'erasure_notice'", "completed_at IS NULL", "interval '24 hours'",
                     "FROM teen_spaces WHERE erase_after < now() - interval '1 day'"]) {
      expect(r.sql).toContain(s);
    }
  });

  it.each([
    ["1 0 0 0", "yourtal_event=1 storage_purge=0 erasure_notice=0 teen_hold_overdue=0"],
    ["0 2 0 0", "yourtal_event=0 storage_purge=2 erasure_notice=0 teen_hold_overdue=0"],
    ["0 0 3 0", "yourtal_event=0 storage_purge=0 erasure_notice=3 teen_hold_overdue=0"],
    ["0 0 0 4", "yourtal_event=0 storage_purge=0 erasure_notice=0 teen_hold_overdue=4"],
  ])("flags %s", (out, want) => {
    expect(run(out).line).toContain(`erasure: open over 24h ${want}`);
  });

  it("flags a failed or garbled query instead of passing it", () => {
    expect(run("psql: error: connection refused", 2).line).toContain("erasure: query failed: psql: error");
    expect(run("garbage").line).toContain("query failed");
    expect(run("0 0 0 0 0").line).toContain("query failed");
    expect(run("0 0 0").line).toContain("query failed");
  });
});
