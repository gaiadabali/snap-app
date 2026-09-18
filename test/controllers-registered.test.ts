import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every `@Controller` class must be registered in a Nest module.
 *
 * WHY THIS EXISTS. OD-11 shipped `CaptureDocumentController` with six passing
 * e2e tests against real Postgres, a clean typecheck, and green CI — and the
 * endpoint did not exist in the running app, because nothing added it to
 * `app.module.ts`. Nest does not warn about this. A controller nobody registers
 * is dead code that looks exactly like live code from every angle a tool checks:
 * it compiles, it is covered, its tests instantiate it directly and pass.
 *
 * That is the same failure as the Dockerfile missing a COPY (green CI, dead
 * container), the `.js` specifier Metro could not resolve (green typecheck,
 * dead bundle), and the build script following `main` (successful build, wrong
 * commit). In each one every signal was green and the only evidence was a
 * person looking at the running thing. This file removes one of those.
 *
 * SCOPED NARROWLY ON PURPOSE. It asserts registration, not reachability —
 * a registered controller behind a broken guard is a different bug, and a rule
 * that tries to catch everything gets switched off the first time it is wrong.
 */

const SERVER_SRC = join(import.meta.dirname, '..', 'apps', 'server', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(SERVER_SRC);

/** Exported classes carrying an `@Controller(...)` decorator, by file. */
function declaredControllers(): Array<{ file: string; name: string }> {
  const found: Array<{ file: string; name: string }> = [];
  for (const file of files.filter((f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(file, 'utf8');
    // `@Controller(...)` then, allowing other decorators between, the class.
    const re = /@Controller\([^)]*\)[\s\S]{0,400}?export class (\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) found.push({ file, name: m[1] });
  }
  return found;
}

/** Class names appearing in any module's `controllers: [ ... ]` array. */
function registeredControllers(): Set<string> {
  const names = new Set<string>();
  for (const file of files.filter((f) => f.endsWith('.module.ts'))) {
    const src = readFileSync(file, 'utf8');
    for (const block of src.matchAll(/controllers:\s*\[([\s\S]*?)\]/g)) {
      for (const name of block[1].matchAll(/(\w+)/g)) names.add(name[1]);
    }
  }
  return names;
}

describe('every controller is registered in a Nest module', () => {
  it('finds the controllers at all — the scanner is not vacuously passing', () => {
    // A regex that matched nothing would make the real assertion below pass
    // for the worst possible reason. This is the floor, not the feature.
    const declared = declaredControllers();
    expect(declared.length).toBeGreaterThan(20);
    expect(declared.map((d) => d.name)).toContain('DeviceReadingController');

    const registered = registeredControllers();
    expect(registered.size).toBeGreaterThan(20);
  });

  it('leaves no controller unregistered', () => {
    const registered = registeredControllers();
    const orphans = declaredControllers()
      .filter((d) => !registered.has(d.name))
      // The path is what makes the failure actionable: the reader needs to know
      // which module to add the import to, not just that a name is missing.
      .map((d) => `${d.name} (${d.file.replace(SERVER_SRC, 'apps/server/src')})`);

    expect(orphans).toEqual([]);
  });
});
