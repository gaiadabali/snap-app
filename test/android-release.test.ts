import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error plain ESM script with no declaration file; it has no dependencies.
import * as ar from '../deploy/apk-release.mjs';

/**
 * The Android release pipeline (task 1.12.b): the pull-based host script, the
 * placement script both release paths share, and the laptop publish that now
 * calls it. Everything runs against temp directories and fake `curl`, `ssh` and
 * `scp`, so no network and no server is touched. They need bash, unzip and
 * sha256sum, which the Linux CI runner has.
 */
// Each case spawns bash, node and unzip several times; Windows is the slow one.
vi.setConfig({ testTimeout: 300_000 });
const DEPLOY = join(import.meta.dirname, '..', 'deploy');
const API = 'https://snap-apps-api.gaiada.com';
const root = mkdtempSync(join(tmpdir(), 'apk-release-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** `C:\a\b` -> `/c/a/b` for Git Bash on a developer's Windows machine; identity elsewhere. */
const posix = (p: string) => p.replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, '/');

// --- a minimal stored (uncompressed) zip, so no dependency and no zip binary ---
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

function fakeApk(o: { versionCode?: number; version?: string; apiUrl?: string; salt?: string }): Buffer {
  const versionCode = o.versionCode ?? 300;
  return zip({
    'assets/index.android.bundle': `var API="${o.apiUrl ?? API}"; // ${o.salt ?? ''}`,
    'assets/app.config': JSON.stringify({
      version: o.version ?? `0.1.${versionCode}`,
      android: { versionCode },
      extra: { versionCode },
    }),
  });
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const NOTES = 'The wallet is faster. Receipts you take offline are sent later.';

// --- fake curl: serves a fake GitHub from $FAKE_GH, and counts what it was asked ---
const BIN = join(root, 'bin');
mkdirSync(BIN);
writeFileSync(
  join(BIN, 'curl'),
  `#!/usr/bin/env bash
out="" hdr="" wfmt="" inm="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -D) hdr="$2"; shift 2 ;;
    -w) wfmt="$2"; shift 2 ;;
    -H) case "$2" in If-None-Match:*) inm="\${2#If-None-Match: }" ;; esac; shift 2 ;;
    -m) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "$FAKE_GH/calls.log"
case "$url" in
  */releases?per_page=*)
    etag="$(cat "$FAKE_GH/etag")"
    [ -n "$hdr" ] && printf 'HTTP/2 200\\r\\nETag: %s\\r\\n\\r\\n' "$etag" > "$hdr"
    if [ "$inm" = "$etag" ]; then : > "$out"; code=304; else cp "$FAKE_GH/releases.json" "$out"; code=200; fi
    [ -n "$wfmt" ] && printf '%s' "$code"
    exit 0 ;;
  https://fake.test/assets/*)
    f="$FAKE_GH/assets/\${url#https://fake.test/assets/}"
    [ -f "$f" ] || exit 22
    cp "$f" "$out"; exit 0 ;;
esac
exit 22
`,
);
// ssh/scp as if the host were this machine: run the command, copy the files.
writeFileSync(join(BIN, 'ssh'), `#!/usr/bin/env bash\nshift\nexec bash -c "$1"\n`);
writeFileSync(
  join(BIN, 'scp'),
  `#!/usr/bin/env bash
args=("$@"); dest="\${args[-1]}"; dest="\${dest#test@fake:}"; unset 'args[-1]'
[ -d "$dest" ] || true
cp "\${args[@]}" "$dest"
`,
);
for (const f of ['curl', 'ssh', 'scp']) chmodSync(join(BIN, f), 0o755);

type Run = { code: number; out: string };
function bash(script: string, args: string[], env: Record<string, string>): Run {
  const r = spawnSync('bash', [posix(script), ...args], {
    encoding: 'utf8',
    timeout: 280_000,
    env: { ...process.env, PATH: `${posix(BIN)}${delimiter}${process.env.PATH}`, ...env },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

let n = 0;
type Box = { dest: string; storage: string; state: string; gh: string; notes: string; env: Record<string, string> };
let box: Box;

beforeEach(() => {
  const dir = join(root, `case-${++n}`);
  const storage = join(dir, 'storage');
  const dest = join(storage, 'downloads', 'android');
  const state = join(dir, 'state');
  const gh = join(dir, 'gh');
  for (const d of [dest, state, join(gh, 'assets')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(gh, 'etag'), '"v1"');
  writeFileSync(join(gh, 'releases.json'), '[]');
  box = {
    dest,
    storage,
    state,
    gh,
    notes: join(dir, 'notes.json'),
    env: {
      FAKE_GH: posix(gh),
      STORAGE_HOST_DIR: posix(storage),
      STATE_DIR: posix(state),
      SECRETS: posix(join(dir, 'no-secrets')),
      REPO_DIR: posix(join(dir, 'no-repo')),
      GITHUB_TOKEN: '',
      GITHUB_API: 'https://fake.test/api',
    },
  };
});

/** Put a release on the fake GitHub; returns the APK bytes. */
function publishRelease(o: {
  versionCode: number;
  apiUrl?: string;
  entryId?: string;
  draft?: boolean;
  prerelease?: boolean;
  apkApiUrl?: string;
  tamper?: boolean;
  etag?: string;
}): Buffer {
  const version = `0.1.${o.versionCode}`;
  const tag = `android-v${version}`;
  const apk = fakeApk({ versionCode: o.versionCode, apiUrl: o.apkApiUrl });
  const build = {
    schema: 1,
    tag,
    version,
    versionCode: o.versionCode,
    commit: 'abc1234',
    apiUrl: o.apiUrl ?? API,
    sha256: sha(apk),
    byteSize: apk.length,
    entry: { id: o.entryId ?? `entry-${o.versionCode}`, date: '2026-10-20', notes: NOTES },
  };
  const assets = join(box.gh, 'assets');
  // `tamper`: the file CI "uploaded" differs from the checksum it recorded.
  writeFileSync(join(assets, `${tag}-apk`), o.tamper ? fakeApk({ versionCode: o.versionCode, salt: 'evil' }) : apk);
  writeFileSync(join(assets, `${tag}-sha`), `${sha(apk)}  snap-apps-android.apk\n`);
  writeFileSync(join(assets, `${tag}-build`), JSON.stringify(build));
  const a = (name: string, file: string) => ({ name, state: 'uploaded', browser_download_url: `https://fake.test/assets/${file}` });
  writeFileSync(
    join(box.gh, 'releases.json'),
    JSON.stringify([
      {
        id: o.versionCode,
        tag_name: tag,
        draft: !!o.draft,
        prerelease: !!o.prerelease,
        assets: [
          a('snap-apps-android.apk', `${tag}-apk`),
          a('snap-apps-android.apk.sha256', `${tag}-sha`),
          a('build.json', `${tag}-build`),
        ],
      },
    ]),
  );
  writeFileSync(join(box.gh, 'etag'), `"${o.etag ?? `r${o.versionCode}`}"`);
  return apk;
}

const pull = (extra: Record<string, string> = {}) => bash(join(DEPLOY, 'pull-apk.sh'), [], { ...box.env, ...extra });
const live = (name: string) => join(box.dest, name);
const manifest = () => JSON.parse(readFileSync(live('manifest.json'), 'utf8'));
const releases = () => JSON.parse(readFileSync(live('releases.json'), 'utf8'));
const callsLog = () => (existsSync(join(box.gh, 'calls.log')) ? readFileSync(join(box.gh, 'calls.log'), 'utf8') : '');

/** What the host holds after an earlier, complete publish of `versionCode`. */
function seedLive(versionCode: number, id = `entry-${versionCode}`) {
  writeFileSync(live('snap-apps-android.apk'), fakeApk({ versionCode }));
  writeFileSync(
    live('manifest.json'),
    JSON.stringify({ version: `0.1.${versionCode}`, versionCode, commit: 'old1234', apiUrl: API, notes: 'Old notes. Two sentences.' }),
  );
  writeFileSync(
    live('releases.json'),
    JSON.stringify([{ id, versionCode, version: `0.1.${versionCode}`, commit: 'old1234', publishedAt: '2026-10-01T00:00:00Z', notes: 'Old notes. Two sentences.' }]),
  );
}

describe('pull-apk.sh', () => {
  it('places a newer release: the APK, releases.json, then manifest.json', () => {
    seedLive(200);
    const apk = publishRelease({ versionCode: 300 });
    const r = pull();
    expect(r.out).toContain('placed android-v0.1.300');
    expect(r.code).toBe(0);
    expect(readFileSync(live('snap-apps-android.apk')).equals(apk)).toBe(true);
    expect(manifest()).toMatchObject({ versionCode: 300, version: '0.1.300', commit: 'abc1234', apiUrl: API, sha256: sha(apk), notes: NOTES });
    expect(releases().map((e: { versionCode: number }) => e.versionCode)).toEqual([300, 200]);
    expect(releases()[0]).toMatchObject({ id: 'entry-300', notes: NOTES });
    // no `.part` or staging leftovers
    expect(existsSync(live('manifest.json.part'))).toBe(false);
    expect(existsSync(live('snap-apps-android.apk.part'))).toBe(false);
  });

  it('places the very first build when nothing is published yet', () => {
    publishRelease({ versionCode: 300 });
    expect(pull().code).toBe(0);
    expect(manifest().versionCode).toBe(300);
    expect(releases()).toHaveLength(1);
  });

  it('ignores an equal versionCode, and an older one, without downloading the APK', () => {
    seedLive(300);
    const before = readFileSync(live('manifest.json'), 'utf8');
    publishRelease({ versionCode: 300 });
    expect(pull().code).toBe(0);
    publishRelease({ versionCode: 250 });
    expect(pull().code).toBe(0);
    expect(readFileSync(live('manifest.json'), 'utf8')).toBe(before);
    expect(callsLog()).not.toContain('-apk');
  });

  it('refuses a sha256 mismatch, places nothing, and tries again on the next tick', () => {
    seedLive(200);
    publishRelease({ versionCode: 300, tamper: true });
    const r = pull();
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/checksum mismatch/);
    expect(manifest().versionCode).toBe(200);
    expect(existsSync(join(box.state, 'apk-releases.etag'))).toBe(false);
  });

  it('refuses when the newest release note is already attached to a published build', () => {
    seedLive(200, 'same-words');
    publishRelease({ versionCode: 300, entryId: 'same-words' });
    const r = pull();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/already attached to build 200/);
    expect(manifest().versionCode).toBe(200);
    expect(readFileSync(live('snap-apps-android.apk')).equals(fakeApk({ versionCode: 200 }))).toBe(true);
    // a permanent refusal is logged once: the next tick is a free 304
    const again = pull();
    expect(again.out).toBe('');
    expect(again.code).toBe(0);
  });

  it('resumes a half-finished earlier run (APK and releases.json landed, manifest did not)', () => {
    seedLive(200);
    const apk = publishRelease({ versionCode: 300 });
    // what a run that died after releases.json leaves behind
    writeFileSync(live('snap-apps-android.apk'), apk);
    writeFileSync(
      live('releases.json'),
      JSON.stringify([
        { id: 'entry-300', versionCode: 300, version: '0.1.300', commit: 'abc1234', publishedAt: '2026-10-20T00:00:00Z', notes: NOTES },
        ...releases(),
      ]),
    );
    expect(manifest().versionCode).toBe(200);
    const r = pull();
    expect(r.code).toBe(0);
    expect(manifest().versionCode).toBe(300);
    expect(releases().filter((e: { id: string }) => e.id === 'entry-300')).toHaveLength(1);
  });

  it('resumes from a half-finished run where only the .part file landed', () => {
    seedLive(200);
    publishRelease({ versionCode: 300 });
    writeFileSync(live('snap-apps-android.apk.part'), 'half');
    expect(pull().code).toBe(0);
    expect(manifest().versionCode).toBe(300);
    expect(existsSync(live('snap-apps-android.apk.part'))).toBe(false);
  });

  it('DRY_RUN=1 checks everything and writes nothing, not even the ETag', () => {
    seedLive(200);
    const before = readFileSync(live('manifest.json'), 'utf8');
    publishRelease({ versionCode: 300 });
    const r = pull({ DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('DRY RUN');
    expect(readFileSync(live('manifest.json'), 'utf8')).toBe(before);
    expect(readFileSync(live('snap-apps-android.apk')).equals(fakeApk({ versionCode: 200 }))).toBe(true);
    expect(existsSync(join(box.state, 'apk-releases.etag'))).toBe(false);
  });

  it('never acts on a draft or a prerelease', () => {
    seedLive(200);
    publishRelease({ versionCode: 300, draft: true });
    expect(pull().code).toBe(0);
    publishRelease({ versionCode: 300, prerelease: true });
    expect(pull().code).toBe(0);
    expect(manifest().versionCode).toBe(200);
    expect(callsLog()).not.toContain('-build');
  });

  it('refuses a release built for another API, and an APK whose bundle lacks the API URL', () => {
    seedLive(200);
    publishRelease({ versionCode: 300, apiUrl: 'https://staging.example.com' });
    expect(pull().out).toMatch(/built for https:\/\/staging.example.com/);
    publishRelease({ versionCode: 301, apkApiUrl: 'https://elsewhere.example.com' });
    const r = pull();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/does not contain/);
    expect(manifest().versionCode).toBe(200);
  });

  it('costs one conditional request when nothing changed (HTTP 304)', () => {
    seedLive(200);
    publishRelease({ versionCode: 300 });
    expect(pull().code).toBe(0);
    const calls = callsLog().split('\n').filter(Boolean).length;
    const again = pull();
    expect(again.code).toBe(0);
    expect(again.out).toBe('');
    expect(callsLog().split('\n').filter(Boolean).length).toBe(calls + 1);
  });
});

describe('place-apk.sh', () => {
  const entry = (id: string) => [{ id, date: '2026-10-20', notes: NOTES }];
  const place = (apk: Buffer, id: string, extra: string[] = [], env: Record<string, string> = {}) => {
    const dir = join(root, `place-${++n}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.apk'), apk);
    writeFileSync(join(dir, 'n.json'), JSON.stringify(entry(id)));
    return bash(
      join(DEPLOY, 'place-apk.sh'),
      ['--apk', posix(join(dir, 'a.apk')), '--notes', posix(join(dir, 'n.json')), '--commit', 'abc1234', '--api-url', API, '--dir', posix(box.dest), ...extra],
      env,
    );
  };

  it('refuses an APK whose embedded versionCode differs from the announced one', () => {
    const r = place(fakeApk({ versionCode: 300 }), 'a-new-entry', ['--expect-version-code', '301']);
    expect(r.code).toBe(1);
    expect(existsSync(live('manifest.json'))).toBe(false);
  });

  it('refuses an APK with no versionCode', () => {
    const r = place(zip({ 'assets/index.android.bundle': API, 'assets/app.config': '{"version":"0.1.0"}' }), 'a-new-entry');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no usable versionCode/);
  });

  it('refuses to go backwards or sideways', () => {
    seedLive(300);
    expect(place(fakeApk({ versionCode: 300 }), 'a-new-entry').code).toBe(1);
    expect(place(fakeApk({ versionCode: 299 }), 'a-new-entry').code).toBe(1);
    expect(manifest().versionCode).toBe(300);
  });

  it('a higher versionCode is the rollback: it places, with its own new notes', () => {
    seedLive(300);
    expect(place(fakeApk({ versionCode: 301, salt: 'rollback' }), 'rolled-back').code).toBe(0);
    expect(manifest().versionCode).toBe(301);
  });
});

describe('publish-apk.sh (laptop path, over fake ssh and scp)', () => {
  const notesFile = () => {
    const f = join(root, `notes-${++n}.json`);
    writeFileSync(f, JSON.stringify([{ id: 'laptop-release', date: '2026-10-20', notes: NOTES }]));
    return f;
  };
  const publish = (apk: Buffer, notes: string, extra: Record<string, string> = {}) => {
    const f = join(root, `laptop-${++n}.apk`);
    writeFileSync(f, apk);
    return bash(join(DEPLOY, 'publish-apk.sh'), [posix(f), 'abc1234'], {
      ...box.env,
      SNAP_DEPLOY_HOST: 'test@fake',
      SNAP_STORAGE_HOST_DIR: posix(box.storage),
      SNAP_RELEASE_NOTES: posix(notes),
      EXPO_PUBLIC_API_URL: API,
      ...extra,
    });
  };

  it('publishes through place-apk.sh and leaves no staging directory behind', () => {
    seedLive(200);
    const apk = fakeApk({ versionCode: 300 });
    const r = publish(apk, notesFile());
    expect(r.code).toBe(0);
    expect(r.out).toContain('published. verify with');
    expect(manifest()).toMatchObject({ versionCode: 300, commit: 'abc1234', sha256: sha(apk), notes: NOTES });
    expect(releases()[0]).toMatchObject({ id: 'laptop-release', versionCode: 300 });
    const left = spawnSync('bash', ['-c', `ls -A '${posix(box.dest)}' | grep incoming || true`], { encoding: 'utf8' }).stdout;
    expect(left.trim()).toBe('');
  });

  it('is refused for a versionCode that is not higher, with nothing changed', () => {
    seedLive(300);
    const before = readFileSync(live('manifest.json'), 'utf8');
    const r = publish(fakeApk({ versionCode: 300, salt: 'x' }), notesFile());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/already has 300/);
    expect(readFileSync(live('manifest.json'), 'utf8')).toBe(before);
  });

  it('is refused when the newest note is already published', () => {
    seedLive(200, 'laptop-release');
    const r = publish(fakeApk({ versionCode: 300 }), notesFile());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/already attached/);
    expect(manifest().versionCode).toBe(200);
  });

  it('is refused for an APK built without the API URL', () => {
    const r = publish(fakeApk({ versionCode: 300, apiUrl: 'https://elsewhere.example.com' }), notesFile());
    expect(r.code).toBe(1);
    expect(existsSync(live('manifest.json'))).toBe(false);
  });

  it('DRY_RUN=1 runs the checks and places nothing', () => {
    seedLive(200);
    const r = publish(fakeApk({ versionCode: 300 }), notesFile(), { DRY_RUN: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(manifest().versionCode).toBe(200);
  });
});

describe('apk-release.mjs', () => {
  const asset = (name: string) => ({ name, state: 'uploaded', browser_download_url: `https://x/${name}` });
  const full = [asset('snap-apps-android.apk'), asset('snap-apps-android.apk.sha256'), asset('build.json')];

  it('picks the newest published android-v* release with all three assets', () => {
    const picked = ar.pickRelease([
      { id: 5, tag_name: 'android-v0.1.5', draft: true, assets: full },
      { id: 4, tag_name: 'android-v0.1.4', prerelease: true, assets: full },
      { id: 3, tag_name: 'mobile-v9', assets: full },
      { id: 2, tag_name: 'android-v0.1.2', assets: full.slice(0, 2) },
      { id: 1, tag_name: 'android-v0.1.1', assets: full },
    ]);
    expect(picked.tag).toBe('android-v0.1.1');
    expect(ar.pickRelease([])).toBeNull();
    expect(ar.pickRelease('nope')).toBeNull();
  });

  const good = () => ({
    schema: 1,
    tag: 'android-v0.1.300',
    version: '0.1.300',
    versionCode: 300,
    commit: 'abc1234',
    apiUrl: API,
    sha256: 'a'.repeat(64),
    byteSize: 10,
    entry: { id: 'x-y-z', date: '2026-10-20', notes: NOTES },
  });

  it('validates build.json, including that the tag names the APK own version', () => {
    expect(ar.validateBuild(good())).toEqual([]);
    expect(ar.validateBuild({ ...good(), tag: 'android-v0.1.301' }).join()).toMatch(/must be android-v0.1.300/);
    expect(ar.validateBuild({ ...good(), version: '0.1.299' }).join()).toMatch(/must end in \.300/);
    expect(ar.validateBuild({ ...good(), sha256: 'zz' }).join()).toMatch(/sha256/);
    expect(ar.validateBuild({ ...good(), entry: undefined }).join()).toMatch(/entry/);
    expect(ar.validateBuild(null)).toHaveLength(1);
  });

  it('build-json carries the newest notes entry and refuses an inconsistent tag', () => {
    const dir = join(root, `bj-${++n}`);
    mkdirSync(dir);
    const notes = join(dir, 'n.json');
    writeFileSync(notes, JSON.stringify([{ id: 'newest-one', date: '2026-10-20', notes: NOTES }, { id: 'older-one', date: '2026-10-01', notes: NOTES }]));
    const args = (tag: string) => ['build-json', '--notes', notes, '--tag', tag, '--version', '0.1.300', '--version-code', '300', '--commit', 'abc1234', '--api-url', API, '--sha256', 'b'.repeat(64), '--size', '99', '--out', join(dir, 'build.json')];
    const errs: string[] = [];
    const io = { out: () => {}, err: (s: string) => errs.push(s) };
    expect(ar.main(args('android-v0.1.301'), io)).toBe(1);
    expect(ar.main(args('android-v0.1.300'), io)).toBe(0);
    const b = JSON.parse(readFileSync(join(dir, 'build.json'), 'utf8'));
    expect(b.entry).toEqual({ id: 'newest-one', date: '2026-10-20', notes: NOTES });
    expect(ar.validateBuild(b)).toEqual([]);
  });
});
