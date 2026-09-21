import { describe, expect, it } from 'vitest';

import {
  evaluateSimulations,
  INTEGRATIONS,
  isSimulated,
  simulationMode,
  specFor,
  type Env,
  type IntegrationId,
} from './simulation.js';

/**
 * `docs/INTEGRATIONS.md` ticket X1, and the gate G-SIM every lane shares:
 * **no simulator can be what is live by accident.**
 *
 * The whole point of this suite is that it is TABLE-DRIVEN over
 * `INTEGRATIONS`. A per-integration test would pass while a sixth integration
 * added later quietly defaulted the wrong way — which is the shape of failure
 * this module was written to prevent, so the test that guards it must grow by
 * itself. Every case below runs for every declared integration, and adding an
 * entry to `INTEGRATIONS` adds its cases with no edit here.
 */

/** A deliberately empty environment. Nothing is inherited from the process. */
const bare: Env = {};

const ids: IntegrationId[] = INTEGRATIONS.map((s) => s.id);

describe('the simulation gate, for every declared integration', () => {
  it('declares at least the five in the queue', () => {
    // The positive control for the table itself. Without it, every loop below
    // would pass vacuously if `INTEGRATIONS` were ever emptied.
    expect(ids).toEqual(expect.arrayContaining(['kms', 'mailer', 'stripe', 'xero', 'powersync']));
  });

  it.each(ids)('%s is ABSENT by default — not simulated, not real', (id) => {
    expect(simulationMode(id, bare)).toBe('absent');
    expect(isSimulated(id, bare)).toBe(false);
  });

  it.each(ids)('%s is NOT enabled by DEMO_ENV alone', (id) => {
    // Marking a deployment "staging" and permitting it to fake an integration
    // are two decisions. Conflating them would turn every demo host into five
    // silent simulators.
    expect(simulationMode(id, { DEMO_ENV: 'staging' })).toBe('absent');
  });

  it.each(ids)('%s is NOT enabled by merely lacking credentials', (id) => {
    // The failure `payment-provider.ts` refuses by name: a stub selected by
    // the absence of configuration. Absence means absent.
    expect(simulationMode(id, { NODE_ENV: 'development' })).toBe('absent');
  });

  it.each(ids)('%s is simulated only with its OWN explicit opt-in', (id) => {
    const spec = specFor(id);
    const env: Env = { NODE_ENV: 'development', [spec.simulatorVar]: 'true' };
    expect(simulationMode(id, env)).toBe('simulated');

    // And the flag is exact-match `'true'`, so a truthy-looking value is off.
    for (const nearly of ['1', 'yes', 'TRUE', 'on', '']) {
      expect(simulationMode(id, { NODE_ENV: 'development', [spec.simulatorVar]: nearly })).toBe(
        'absent',
      );
    }
  });

  it.each(ids)('%s enabling one simulator does not enable another', (id) => {
    const spec = specFor(id);
    const env: Env = { NODE_ENV: 'development', [spec.simulatorVar]: 'true' };
    for (const other of ids) {
      if (other === id) continue;
      expect(simulationMode(other, env)).toBe('absent');
    }
  });

  it.each(ids)('%s REFUSES the simulator in production without DEMO_ENV', (id) => {
    const spec = specFor(id);
    const env: Env = { NODE_ENV: 'production', [spec.simulatorVar]: 'true' };

    // Not 'simulated'. A production host that asked for a simulator gets
    // nothing, and `evaluateSimulations` below makes that fatal at boot
    // rather than leaving it to a support ticket.
    expect(simulationMode(id, env)).toBe('absent');

    const report = evaluateSimulations(env);
    expect(report.active).toEqual([]);
    expect(report.refused.map((f) => f.id)).toEqual([id]);
    expect(report.refused[0]!.message).toContain(spec.simulatorVar);
    expect(report.refused[0]!.message).toContain('DEMO_ENV=staging');
  });

  it.each(ids)('%s is permitted in production WITH DEMO_ENV=staging, and warns', (id) => {
    const spec = specFor(id);
    const env: Env = { NODE_ENV: 'production', DEMO_ENV: 'staging', [spec.simulatorVar]: 'true' };

    expect(simulationMode(id, env)).toBe('simulated');

    const report = evaluateSimulations(env);
    expect(report.refused).toEqual([]);
    expect(report.active.map((f) => f.id)).toEqual([id]);
    // The operator is told what it speaks, so "simulated" is not read as
    // "not really tested".
    expect(report.active[0]!.message).toContain(spec.protocol);
  });

  it.each(ids)('%s real credentials WIN over a stale simulator flag', (id) => {
    const spec = specFor(id);
    for (const credential of spec.credentialVars) {
      const env: Env = {
        NODE_ENV: 'production',
        DEMO_ENV: 'staging',
        [spec.simulatorVar]: 'true',
        [credential]: 'a-real-looking-value',
      };

      // The property lifted from `isGoogleSignInSimulatorEnabled`: nobody has
      // to remember to turn the simulator off on the day the vendor goes live.
      expect(simulationMode(id, env)).toBe('real');

      // And it is not reported as an active simulator, because it is not one.
      expect(evaluateSimulations(env).active).toEqual([]);
    }
  });

  it.each(ids)('%s an empty or whitespace credential is not a credential', (id) => {
    const spec = specFor(id);
    const credential = spec.credentialVars[0]!;
    // An env var set to '' is how a compose file spells "unset" by accident.
    // Reading that as "real" would point the client at a vendor it has no
    // address for, and the failure would be a connection error at first use.
    expect(simulationMode(id, { NODE_ENV: 'development', [credential]: '' })).toBe('absent');
    expect(simulationMode(id, { NODE_ENV: 'development', [credential]: '   ' })).toBe('absent');
  });
});

describe('the report a boot reads', () => {
  it('says nothing when nothing is simulated', () => {
    const report = evaluateSimulations({ NODE_ENV: 'production' });
    expect(report.active).toEqual([]);
    expect(report.refused).toEqual([]);
  });

  it('reports every active simulator, not just the first', () => {
    // A demo host runs several at once. A report that stopped at one would
    // let the other four be forgotten.
    const env: Env = { NODE_ENV: 'production', DEMO_ENV: 'staging' };
    for (const spec of INTEGRATIONS) env[spec.simulatorVar] = 'true';

    const report = evaluateSimulations(env);
    expect(report.active.map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(report.refused).toEqual([]);
  });

  it('reports every refusal, not just the first', () => {
    const env: Env = { NODE_ENV: 'production' };
    for (const spec of INTEGRATIONS) env[spec.simulatorVar] = 'true';

    const report = evaluateSimulations(env);
    expect(report.refused.map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(report.active).toEqual([]);
  });

  it('refuses to answer for an id that does not exist', () => {
    // Reachable only through a cast at a boundary, which is exactly where a
    // typo'd integration id would arrive from.
    expect(() => specFor('sftp' as IntegrationId)).toThrow(/Unknown integration id/);
  });
});
